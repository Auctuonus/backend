import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './controllers/app.controller';
import { AuthController } from './controllers/auth.controller';
import { AppService } from './services/app.service';
import { ModelsModule } from './models/models.module';
import { RedisModule } from './redis/redis.module';
import configuration from './config';

@Module({
  imports: [
    MongooseModule.forRoot(configuration().mongodbUrl),
    RedisModule,
    ModelsModule,
  ],
  controllers: [AppController, AuthController],
  providers: [AppService],
})
export class AppModule {}
