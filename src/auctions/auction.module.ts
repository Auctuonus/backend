import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Auction, AuctionSchema } from '../models/auction.schema';
import { Item, ItemSchema } from '../models/item.schema';
import { Bid, BidSchema } from '../models/bid.schema';
import { AuctionService } from './auction.service';
import { AuctionController } from './auction.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Auction.name, schema: AuctionSchema },
      { name: Item.name, schema: ItemSchema },
      { name: Bid.name, schema: BidSchema },
    ]),
    AuthModule,
  ],
  controllers: [AuctionController],
  providers: [AuctionService],
  exports: [AuctionService],
})
export class AuctionModule {}
