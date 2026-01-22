import { Injectable } from '@nestjs/common';
import { LockMetrics } from './distributed-lock.service';

/**
 * Mock implementation of DistributedLockService for testing
 * Actually serializes access using in-memory locks to properly test concurrent scenarios
 */
@Injectable()
export class MockDistributedLockService {
  private locks: Map<string, Promise<void>> = new Map();
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
  ): Promise<T> {
    const lockKey = `lock:${key}`;
    
    // Wait for existing lock to be released
    while (this.locks.has(lockKey)) {
      await this.locks.get(lockKey);
    }

    // Create a new lock promise
    let releaseLock: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    this.locks.set(lockKey, lockPromise);

    this.metrics.acquired++;
    try {
      return await fn();
    } finally {
      this.metrics.released++;
      this.locks.delete(lockKey);
      releaseLock!();
    }
  }

  async extendLock(key: string, token: string): Promise<boolean> {
    return true;
  }

  async isLocked(key: string): Promise<boolean> {
    return this.locks.has(`lock:${key}`);
  }
}
