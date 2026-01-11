import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Bid, BidSchema } from '../models/bid.schema';
import { Auction, AuctionSchema } from '../models/auction.schema';
import { Wallet, WalletSchema } from '../models/wallet.schema';
import { Transaction, TransactionSchema } from '../models/transaction.schema';
import { BidPlacementService } from './bid-placement.service';
import { BidQueryService } from './bid-query.service';
import { BidController } from './bid.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Bid.name, schema: BidSchema },
      { name: Auction.name, schema: AuctionSchema },
      { name: Wallet.name, schema: WalletSchema },
      { name: Transaction.name, schema: TransactionSchema },
    ]),
    AuthModule,
  ],
  controllers: [BidController],
  providers: [BidPlacementService, BidQueryService],
  exports: [BidPlacementService, BidQueryService],
})
export class BidModule {}
