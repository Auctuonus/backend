import { Nack, RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { Injectable, Logger } from '@nestjs/common';
import { JobMessage } from './dto';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import {
  Auction,
  AuctionDocument,
  AuctionRound,
  AuctionStatus,
  Bid,
  BidDocument,
  BidStatus,
  Item,
  ItemDocument,
  RelatedEntityType,
  Transaction,
  TransactionDocument,
  TransactionType,
  Wallet,
  WalletDocument,
} from 'src/models';
import { ClientSession, Connection, Model } from 'mongoose';

@Injectable()
export class AuctionProcessingService {
  private readonly logger = new Logger(AuctionProcessingService.name);
  constructor(
    @InjectConnection() private connection: Connection,
    @InjectModel(Auction.name) private auctionModel: Model<AuctionDocument>,
    @InjectModel(Item.name) private itemModel: Model<ItemDocument>,
    @InjectModel(Bid.name) private bidModel: Model<BidDocument>,
    @InjectModel(Wallet.name) private walletModel: Model<WalletDocument>,
    @InjectModel(Transaction.name)
    private transactionModel: Model<TransactionDocument>,
  ) {}

  @RabbitSubscribe({
    exchange: 'delayed.ex',
    routingKey: 'jobs',
    queue: 'jobs.q',
    queueOptions: { durable: true },
  })
  async processAuction(msg: JobMessage) {
    try {
      return await this._processAuction(msg);
    } catch (error) {
      this.logger.error(error);
      return new Nack(true);
    }
  }

  private async _processAuction(msg: JobMessage): Promise<Nack | null> {
    const session: ClientSession = await this.connection.startSession();
    session.startTransaction();

    let result: Nack | null = null;
    try {
      result = await this._processAuctionWithSession(msg, session);
    } catch (error) {
      this.logger.error(error);
      await session.abortTransaction();
      return new Nack(true);
    } finally {
      await session.endSession();
    }
    return result;
  }

  private async _processAuctionWithSession(
    msg: JobMessage,
    session: ClientSession,
  ): Promise<Nack | null> {
    const now = new Date();
    const auction = await this.auctionModel
      .findById(msg.auctionId)
      .session(session)
      .exec();
    if (!auction) {
      return new Nack(false);
    }
    if (auction.status !== AuctionStatus.ACTIVE) {
      return new Nack(false);
    }
    for (const round of auction.rounds) {
      if (round.status !== AuctionStatus.ACTIVE) continue;
      if (round.endTime >= now) continue; // Skip rounds that haven't ended yet
      await this._processRound(auction, round, session);
    }

    await session.commitTransaction();
    return null;
  }

  private async _processRound(
    auction: AuctionDocument,
    round: AuctionRound,
    session: ClientSession,
  ) {
    const { items, topBids } = await this._getEntities(auction, round, session);

    for (const bid of topBids) {
      bid.status = BidStatus.WON;
    }
    await this.bidModel.updateMany(
      { _id: { $in: topBids.map((bid) => bid._id) } },
      {
        $set: {
          status: BidStatus.WON,
          updatedAt: new Date(),
        },
      },
      { session },
    );

    // Limit to the number of winning bids (might be fewer than items if not enough bids)
    const winningCount = Math.min(items.length, topBids.length);

    for (let i = 0; i < winningCount; i++) {
      const item = items[i];
      const bid = topBids[i];

      item.ownerId = bid.userId;
      item.updatedAt = new Date();
      await item.save({ session });

      await this.walletModel.updateOne(
        { userId: item.ownerId },
        {
          $inc: {
            balance: -bid.amount,
            lockedBalance: -bid.amount,
          },
        },
        { session },
      );
      await this.transactionModel.create(
        [
          {
            fromWalletId: bid.userId,
            toWalletId: auction.sellerWalletId,
            amount: bid.amount,
            type: TransactionType.TRANSFER,
            relatedEntityId: auction._id,
            relatedEntityType: RelatedEntityType.AUCTION,
            description: 'Auction win transfer',
          },
        ],
        { session },
      );
    }
    await this.walletModel.updateOne(
      { userId: auction.sellerId },
      {
        $inc: {
          balance: topBids.reduce((acc, bid) => acc + bid.amount, 0),
        },
      },
      { session },
    );
    round.status = AuctionStatus.ENDED;
    await auction.save({ session });

    // End auction if this is the last round
    const isLastRound = round === auction.rounds[auction.rounds.length - 1];
    if (!isLastRound) {
      return;
    }

    auction.status = AuctionStatus.ENDED;
    await auction.save({ session });

    await this.bidModel.updateMany(
      { auctionId: auction._id, status: BidStatus.ACTIVE },
      {
        $set: {
          status: BidStatus.LOST,
          updatedAt: new Date(),
        },
      },
      { session },
    );
    const bids = await this.bidModel
      .find({ auctionId: auction._id, status: BidStatus.LOST })
      .session(session)
      .exec();
    for (const bid of bids) {
      await this.walletModel.updateOne(
        { userId: bid.userId },
        { $inc: { lockedBalance: -bid.amount } },
        { session },
      );
    }
  }

  private async _getEntities(
    auction: AuctionDocument,
    round: AuctionRound,
    session: ClientSession,
  ) {
    const items = await this.itemModel
      .find({ _id: { $in: round.itemIds } })
      .sort({ num: 1 })
      .session(session)
      .exec();

    const topBids = await this.bidModel
      .find({
        auctionId: auction._id,
        status: BidStatus.ACTIVE,
      })
      .sort({ amount: -1 })
      .limit(items.length)
      .session(session)
      .exec();
    return { items, topBids };
  }
}
