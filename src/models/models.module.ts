import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  User,
  UserSchema,
  Wallet,
  WalletSchema,
  Transaction,
  TransactionSchema,
  Item,
  ItemSchema,
  Bid,
  BidSchema,
  Auction,
  AuctionSchema,
} from '.';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Wallet.name, schema: WalletSchema },
      { name: Transaction.name, schema: TransactionSchema },
      { name: Item.name, schema: ItemSchema },
      { name: Bid.name, schema: BidSchema },
      { name: Auction.name, schema: AuctionSchema },
    ]),
  ],
  exports: [MongooseModule],
})
export class ModelsModule {}
