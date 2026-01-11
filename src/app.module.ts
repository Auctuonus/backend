import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ModelsModule } from './models/models.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './users/user.module';
import { AuctionModule } from './auctions/auction.module';
import { BidModule } from './bids/bid.module';
import configuration from './config';

@Module({
  imports: [
    MongooseModule.forRoot(configuration().mongodbUrl),
    RedisModule,
    ModelsModule,
    AuthModule,
    UserModule,
    AuctionModule,
    BidModule,
  ],
})
export class AppModule {}
