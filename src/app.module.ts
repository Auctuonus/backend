import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ModelsModule } from './models/models.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './users/user.module';
import { AuctionModule } from './auctions/auction.module';
import { BidModule } from './bids/bid.module';
import configuration from './config';
import { AuthController } from './auth/auth.controller';
import { UserController } from './users/user.controller';
import { AuctionController } from './auctions/auction.controller';
import { BidController } from './bids/bid.controller';
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { AuctionProcessingService } from './auctions/auction.consumer';
import { HealthcheckController } from './utils/healthcheck.controller';

@Module({
  imports: [
    MongooseModule.forRoot(configuration().mongodbUrl),
    RedisModule.forRoot(),
    ModelsModule,
    AuthModule,
    UserModule,
    AuctionModule,
    BidModule,
  ],
  controllers: [
    AuthController,
    UserController,
    AuctionController,
    BidController,
    HealthcheckController,
  ],
})
export class AppModule {}

@Module({
  imports: [
    MongooseModule.forRoot(configuration().mongodbUrl),
    RedisModule.forRoot(),
    RabbitMQModule.forRoot(configuration().rabbitmq),
    ModelsModule,
    AuthModule,
    UserModule,
    AuctionModule,
    BidModule,
  ],
  controllers: [HealthcheckController],
  providers: [AuctionProcessingService],
  exports: [AuctionProcessingService],
})
export class RunnerModule {}
