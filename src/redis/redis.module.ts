import { Module, DynamicModule } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { redisStore } from 'cache-manager-redis-yet';
import Redis from 'ioredis';
import configuration from '../config';
import { DistributedLockService } from './distributed-lock.service';
import { MockDistributedLockService } from './distributed-lock.service.mock';

export const REDIS_PUBLISHER = 'REDIS_PUBLISHER';
export const REDIS_SUBSCRIBER = 'REDIS_SUBSCRIBER';

@Module({})
export class RedisModule {
  static forRoot(): DynamicModule {
    const config = configuration();

    return {
      global: true,
      module: RedisModule,
      imports: [
        CacheModule.registerAsync({
          isGlobal: true,
          useFactory: async () => {
            return {
              store: await redisStore({
                socket: {
                  host: config.redis.host,
                  port: config.redis.port,
                },
              }),
            };
          },
        }),
      ],
      providers: [
        {
          provide: REDIS_PUBLISHER,
          useFactory: () => {
            return new Redis({
              host: config.redis.host,
              port: config.redis.port,
              lazyConnect: true,
            });
          },
        },
        {
          provide: REDIS_SUBSCRIBER,
          useFactory: () => {
            return new Redis({
              host: config.redis.host,
              port: config.redis.port,
              lazyConnect: true,
            });
          },
        },
        DistributedLockService,
      ],
      exports: [DistributedLockService, REDIS_PUBLISHER, REDIS_SUBSCRIBER],
    };
  }

  static forTest(): DynamicModule {
    return {
      global: true,
      module: RedisModule,
      providers: [
        {
          provide: DistributedLockService,
          useClass: MockDistributedLockService,
        },
      ],
      exports: [DistributedLockService],
    };
  }
}
