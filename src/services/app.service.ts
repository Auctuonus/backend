import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

@Injectable()
export class AppService {
  constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {}

  getHello(): string {
    return 'Hello World!';
  }

  // Example: Cache usage
  async exampleCacheUsage(): Promise<void> {
    // Set value with 1 hour TTL
    await this.cacheManager.set('example-key', { data: 'value' }, 3600000);

    // Get value
    const value = await this.cacheManager.get('example-key');
    console.log('Cached value:', value);

    // Delete value
    await this.cacheManager.del('example-key');
  }
}
