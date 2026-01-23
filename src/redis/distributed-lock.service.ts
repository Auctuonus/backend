import {
  Injectable,
  Inject,
  Logger,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import type Redis from 'ioredis';
import { REDIS_PUBLISHER, REDIS_SUBSCRIBER } from './redis.module';
import { EventEmitter } from 'events';

export interface LockMetrics {
  acquired: number;
  released: number;
  failed: number;
  totalWaitTimeMs: number;
  avgWaitTimeMs: number;
}

@Injectable()
export class DistributedLockService implements OnModuleDestroy {
  private readonly logger = new Logger(DistributedLockService.name);
  private readonly lockEmitter = new EventEmitter();
  private metrics: LockMetrics = {
    acquired: 0,
    released: 0,
    failed: 0,
    totalWaitTimeMs: 0,
    avgWaitTimeMs: 0,
  };
  private readonly pubSubEnabled: boolean;

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    @Optional() @Inject(REDIS_PUBLISHER) private redisPublisher?: Redis,
    @Optional() @Inject(REDIS_SUBSCRIBER) private redisSubscriber?: Redis,
  ) {
    this.pubSubEnabled = !!(this.redisPublisher && this.redisSubscriber);
    if (this.pubSubEnabled) {
      this.setupSubscriber();
    } else {
      this.logger.warn(
        'Redis Pub/Sub not available - running in fallback mode',
      );
    }
  }

  private setupSubscriber(): void {
    if (!this.redisSubscriber) return;

    // Подписываемся на канал освобождения блокировок
    this.redisSubscriber.psubscribe('lock:released:*', (err: Error | null) => {
      if (err) {
        this.logger.error('Failed to subscribe to lock release channel', err);
      } else {
        this.logger.log('Subscribed to lock release notifications');
      }
    });

    // Обработчик сообщений
    this.redisSubscriber.on('pmessage', (pattern, channel, message) => {
      const key = channel.replace('lock:released:', '');
      this.logger.debug(`Lock released notification for: ${key}`);
      this.lockEmitter.emit(`released:${key}`, message);
    });
  }

  async onModuleDestroy() {
    if (this.redisSubscriber) {
      await this.redisSubscriber.punsubscribe('lock:released:*');
      await this.redisSubscriber.quit();
    }
    if (this.redisPublisher) {
      await this.redisPublisher.quit();
    }
  }

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

        // Публикуем событие об освобождении блокировки (если Pub/Sub доступен)
        if (this.redisPublisher) {
          await this.redisPublisher.publish(
            `lock:released:${key}`,
            JSON.stringify({ token, timestamp: Date.now() }),
          );
        }

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

  /**
   * Получение блокировки с ожиданием через Pub/Sub
   * Ждет события освобождения блокировки вместо постоянных проверок
   * Не нагружает Redis, масштабируется на тысячи ожидающих процессов
   */
  async acquireLockWithPubSub(
    key: string,
    options: {
      timeoutMs?: number;
      maxAttempts?: number;
    } = {},
  ): Promise<string> {
    if (!this.pubSubEnabled) {
      this.logger.warn('Pub/Sub not enabled, acquiring lock without waiting');
      const token = await this.acquireLock(key);
      if (!token) {
        throw new Error(
          `Failed to acquire lock for key: ${key} (Pub/Sub not available)`,
        );
      }
      return token;
    }

    const { timeoutMs = 30000, maxAttempts = 1000 } = options;
    const startTime = Date.now();
    let attempts = 0;

    while (attempts < maxAttempts) {
      // Проверяем таймаут
      if (Date.now() - startTime >= timeoutMs) {
        this.logger.warn(
          `Lock acquisition timeout for ${key} after ${attempts} attempts (${Date.now() - startTime}ms)`,
        );
        throw new Error(
          `Failed to acquire lock for key: ${key} (timeout after ${timeoutMs}ms)`,
        );
      }

      // Пытаемся получить блокировку
      const token = await this.acquireLock(key);
      if (token) {
        this.logger.debug(
          `Lock acquired after ${attempts} attempts (${Date.now() - startTime}ms)`,
        );
        return token;
      }

      attempts++;

      // Ждем события освобождения блокировки или таймаут
      const remainingTime = timeoutMs - (Date.now() - startTime);
      if (remainingTime <= 0) {
        throw new Error(
          `Failed to acquire lock for key: ${key} (timeout after ${timeoutMs}ms)`,
        );
      }

      await this.waitForLockRelease(key, Math.min(remainingTime, 5000));
    }

    throw new Error(
      `Failed to acquire lock for key: ${key} (max attempts ${maxAttempts} reached)`,
    );
  }

  /**
   * Ждет события освобождения блокировки через Pub/Sub
   */
  private waitForLockRelease(key: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const eventName = `released:${key}`;
      let timeoutId: NodeJS.Timeout;

      const cleanup = () => {
        this.lockEmitter.removeListener(eventName, onRelease);
        clearTimeout(timeoutId);
      };

      const onRelease = () => {
        cleanup();
        resolve();
      };

      // Слушаем событие освобождения
      this.lockEmitter.once(eventName, onRelease);

      // Таймаут на случай если событие не придет
      timeoutId = setTimeout(() => {
        cleanup();
        resolve(); // Все равно пытаемся снова получить блокировку
      }, timeoutMs);
    });
  }

  async withLock<T>(
    key: string,
    fn: () => Promise<T>,
    options?: {
      timeoutMs?: number;
      maxAttempts?: number;
    },
  ): Promise<T> {
    const token = await this.acquireLockWithPubSub(key, options || {});

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
