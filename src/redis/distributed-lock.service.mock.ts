import { Injectable } from '@nestjs/common';
import { LockOptions, LockMetrics } from './distributed-lock.service';

/**
 * Mock implementation of DistributedLockService for testing
 * Always acquires locks immediately without actual Redis operations
 */
@Injectable()
export class MockDistributedLockService {
  private metrics: LockMetrics = {
    acquired: 0,
    released: 0,
    failed: 0,
    totalWaitTimeMs: 0,
    avgWaitTimeMs: 0,
  };

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
    this.metrics.acquired++;
    return `mock-token-${Date.now()}`;
  }

  async releaseLock(key: string, token: string): Promise<boolean> {
    this.metrics.released++;
    return true;
  }

  async withLock<T>(
    key: string,
    fn: () => Promise<T>,
    options: LockOptions = {},
  ): Promise<T> {
    this.metrics.acquired++;
    try {
      return await fn();
    } finally {
      this.metrics.released++;
    }
  }

  async extendLock(key: string, token: string, ttlMs: number): Promise<boolean> {
    return true;
  }

  async isLocked(key: string): Promise<boolean> {
    return false;
  }
}
