import { Injectable, Inject, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

export interface LockOptions {
  ttlMs?: number;
  retryDelayMs?: number;
  maxRetries?: number;
  retryJitterMs?: number;
}

export interface LockMetrics {
  acquired: number;
  released: number;
  failed: number;
  totalWaitTimeMs: number;
  avgWaitTimeMs: number;
}

const DEFAULT_TTL_MS = 30000;
const DEFAULT_RETRY_DELAY_MS = 50;
const DEFAULT_MAX_RETRIES = 300;
const DEFAULT_RETRY_JITTER_MS = 25;
const MAX_BACKOFF_MS = 500;

@Injectable()
export class DistributedLockService {
  private readonly logger = new Logger(DistributedLockService.name);
  private metrics: LockMetrics = {
    acquired: 0,
    released: 0,
    failed: 0,
    totalWaitTimeMs: 0,
    avgWaitTimeMs: 0,
  };

  constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {}

  getMetrics(): LockMetrics {
    return { ...this.metrics };
  }

  resetMetrics(): void {
    this.metrics = {
      acquired: 0,
      released: 0,
      failed: 0,
      totalWaitTimeMs: 0,
      avgWaitTimeMs: 0,
    };
  }

  async acquireLock(
    key: string,
    options: LockOptions = {},
  ): Promise<string | null> {
    const {
      ttlMs = DEFAULT_TTL_MS,
      retryDelayMs = DEFAULT_RETRY_DELAY_MS,
      maxRetries = DEFAULT_MAX_RETRIES,
      retryJitterMs = DEFAULT_RETRY_JITTER_MS,
    } = options;

    const lockKey = `lock:${key}`;
    const lockToken = `${Date.now()}-${Math.random().toString(36).substring(2)}-${process.pid}`;
    const startTime = Date.now();

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const existingLock = await this.cacheManager.get<string>(lockKey);

        if (!existingLock) {
          await this.cacheManager.set(lockKey, lockToken, ttlMs);
          const verifyLock = await this.cacheManager.get<string>(lockKey);
          
          if (verifyLock === lockToken) {
            const waitTime = Date.now() - startTime;
            this.metrics.acquired++;
            this.metrics.totalWaitTimeMs += waitTime;
            this.metrics.avgWaitTimeMs = this.metrics.totalWaitTimeMs / this.metrics.acquired;
            
            this.logger.debug(
              `Lock acquired: ${lockKey} (attempt ${attempt + 1}, wait ${waitTime}ms)`,
            );
            return lockToken;
          }
        }

        if (attempt < maxRetries) {
          const backoff = Math.min(
            retryDelayMs * Math.pow(1.5, Math.min(attempt, 10)),
            MAX_BACKOFF_MS,
          );
          const jitter = Math.random() * retryJitterMs;
          await this.sleep(backoff + jitter);
        }
      } catch (error) {
        this.logger.error(`Lock acquire error for ${lockKey}:`, error);
        if (attempt < maxRetries) {
          await this.sleep(retryDelayMs * 2);
        }
      }
    }

    const waitTime = Date.now() - startTime;
    this.metrics.failed++;
    this.logger.warn(
      `Failed to acquire lock: ${lockKey} after ${maxRetries} retries (${waitTime}ms)`,
    );
    return null;
  }

  async releaseLock(key: string, token: string): Promise<boolean> {
    const lockKey = `lock:${key}`;

    try {
      const currentToken = await this.cacheManager.get<string>(lockKey);
      if (currentToken === token) {
        await this.cacheManager.del(lockKey);
        this.metrics.released++;
        this.logger.debug(`Lock released: ${lockKey}`);
        return true;
      }

      if (!currentToken) {
        this.logger.warn(`Lock already expired: ${lockKey}`);
        return false;
      }

      this.logger.warn(`Lock token mismatch: ${lockKey}`);
      return false;
    } catch (error) {
      this.logger.error(`Lock release error for ${lockKey}:`, error);
      return false;
    }
  }

  async withLock<T>(
    key: string,
    fn: () => Promise<T>,
    options: LockOptions = {},
  ): Promise<T> {
    const token = await this.acquireLock(key, options);

    if (!token) {
      throw new Error(`Failed to acquire lock for key: ${key}`);
    }

    try {
      return await fn();
    } finally {
      await this.releaseLock(key, token);
    }
  }

  async extendLock(key: string, token: string, ttlMs: number): Promise<boolean> {
    const lockKey = `lock:${key}`;

    try {
      const currentToken = await this.cacheManager.get<string>(lockKey);
      if (currentToken === token) {
        await this.cacheManager.set(lockKey, token, ttlMs);
        this.logger.debug(`Lock extended: ${lockKey} for ${ttlMs}ms`);
        return true;
      }
      return false;
    } catch (error) {
      this.logger.error(`Lock extend error for ${lockKey}:`, error);
      return false;
    }
  }

  async isLocked(key: string): Promise<boolean> {
    const lockKey = `lock:${key}`;
    const token = await this.cacheManager.get<string>(lockKey);
    return !!token;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
