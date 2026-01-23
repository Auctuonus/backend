import { Injectable, Inject, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

export interface LockMetrics {
  acquired: number;
  released: number;
  failed: number;
  totalWaitTimeMs: number;
  avgWaitTimeMs: number;
}

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

  async acquireLock(key: string): Promise<string | null> {
    const lockKey = `lock:${key}`;
    const lockToken = `${Date.now()}-${Math.random().toString(36).substring(2)}-${process.pid}`;
    const startTime = Date.now();

    try {
      const existingLock = await this.cacheManager.get<string>(lockKey);
      if (!existingLock) {
        await this.cacheManager.set(lockKey, lockToken);
        const verifyLock = await this.cacheManager.get<string>(lockKey);

        if (verifyLock === lockToken) {
          const waitTime = Date.now() - startTime;
          this.metrics.acquired++;
          this.metrics.totalWaitTimeMs += waitTime;
          this.metrics.avgWaitTimeMs =
            this.metrics.totalWaitTimeMs / this.metrics.acquired;

          this.logger.debug(`Lock acquired: ${lockKey} (wait ${waitTime}ms)`);
          return lockToken;
        }
      }
    } catch (error) {
      this.logger.error(`Lock acquire error for ${lockKey}:`, error);
    }

    const waitTime = Date.now() - startTime;
    this.metrics.failed++;
    this.logger.warn(
      `Failed to acquire lock: ${lockKey} retries (${waitTime}ms)`,
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

  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const token = await this.acquireLock(key);

    if (!token) {
      throw new Error(`Failed to acquire lock for key: ${key}`);
    }

    try {
      return await fn();
    } finally {
      await this.releaseLock(key, token);
    }
  }

  async extendLock(key: string, token: string): Promise<boolean> {
    const lockKey = `lock:${key}`;

    try {
      const currentToken = await this.cacheManager.get<string>(lockKey);
      if (currentToken === token) {
        await this.cacheManager.set(lockKey, token);
        this.logger.debug(`Lock extended: ${lockKey}`);
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
}
