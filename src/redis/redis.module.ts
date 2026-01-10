import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { redisStore } from 'cache-manager-redis-yet';
import configuration from '../config';

@Module({
  imports: [
    CacheModule.registerAsync({
      isGlobal: true,
      useFactory: async () => {
        const config = configuration();
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
})
export class RedisModule {}
