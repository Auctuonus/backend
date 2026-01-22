import { Nack, RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { Injectable, Logger } from '@nestjs/common';
import { JobMessage } from './dto';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import {
  Auction,
  AuctionDocument,
  AuctionRound,
  AuctionStatus,
  RoundProcessingStatus,
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
import { DistributedLockService } from '../redis/distributed-lock.service';

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
    private distributedLockService: DistributedLockService,
  ) {}

  @RabbitSubscribe({
    exchange: 'delayed.ex',
    routingKey: 'jobs',
    queue: 'jobs.q',
    queueOptions: { durable: true },
  })
  async processAuction(msg: JobMessage) {
    const auctionLockKey = `auction:${msg.auctionId}`;
    const startTime = Date.now();
    const publishedAt = new Date(msg.publishedAt).getTime();
    const queueDelayMs = startTime - publishedAt;

    this.logger.log(
      `Processing auction ${msg.auctionId}, queue delay: ${queueDelayMs}ms, message id: ${msg.id}`,
    );

    if (queueDelayMs > 5000) {
      this.logger.warn(
        `High queue delay detected for auction ${msg.auctionId}: ${queueDelayMs}ms`,
      );
    }

    try {
      const result = await this.distributedLockService.withLock(
        auctionLockKey,
        () => this._processAuction(msg),
      );

      const processingTimeMs = Date.now() - startTime;
      this.logger.log(
        `Auction ${msg.auctionId} processed in ${processingTimeMs}ms`,
      );

      return result;
    } catch (error) {
      const processingTimeMs = Date.now() - startTime;
      this.logger.error(
        `Failed to process auction ${msg.auctionId} after ${processingTimeMs}ms:`,
        error,
      );
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
    const roundIndex = auction.rounds.indexOf(round);
    this.logger.log(`Processing round ${roundIndex} for auction ${auction._id}`);

    // Step 1: Mark winners
    await this._updateRoundProcessingStatus(
      auction,
      roundIndex,
      RoundProcessingStatus.PROCESSING_WINNERS,
      session,
    );
    const { items, topBids } = await this._markWinners(auction, round, session);

    // Step 2: Transfer items and funds
    await this._updateRoundProcessingStatus(
      auction,
      roundIndex,
      RoundProcessingStatus.PROCESSING_TRANSFERS,
      session,
    );
    await this._processWinnerTransfers(auction, items, topBids, session);

    // Step 3: Process losers (only for last round)
    const isLastRound = roundIndex === auction.rounds.length - 1;
    if (isLastRound) {
      await this._updateRoundProcessingStatus(
        auction,
        roundIndex,
        RoundProcessingStatus.PROCESSING_LOSERS,
        session,
      );
      await this._processLosers(auction, session);
    }

    // Step 4: Mark round as completed
    await this._updateRoundProcessingStatus(
      auction,
      roundIndex,
      RoundProcessingStatus.COMPLETED,
      session,
    );
    round.status = AuctionStatus.ENDED;

    if (isLastRound) {
      auction.status = AuctionStatus.ENDED;
    }
    await auction.save({ session });

    this.logger.log(`Round ${roundIndex} for auction ${auction._id} completed`);
  }

  private async _updateRoundProcessingStatus(
    auction: AuctionDocument,
    roundIndex: number,
    status: RoundProcessingStatus,
    session: ClientSession,
  ): Promise<void> {
    await this.auctionModel.updateOne(
      { _id: auction._id },
      { $set: { [`rounds.${roundIndex}.processingStatus`]: status } },
      { session },
    );
    auction.rounds[roundIndex].processingStatus = status;
    this.logger.debug(
      `Auction ${auction._id} round ${roundIndex} status: ${status}`,
    );
  }

  private async _markWinners(
    auction: AuctionDocument,
    round: AuctionRound,
    session: ClientSession,
  ): Promise<{ items: ItemDocument[]; topBids: BidDocument[] }> {
    const { items, topBids } = await this._getEntities(auction, round, session);

    if (topBids.length > 0) {
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

      for (const bid of topBids) {
        bid.status = BidStatus.WON;
      }
    }

    return { items, topBids };
  }

  private async _processWinnerTransfers(
    auction: AuctionDocument,
    items: ItemDocument[],
    topBids: BidDocument[],
    session: ClientSession,
  ): Promise<void> {
    const winningCount = Math.min(items.length, topBids.length);
    let totalTransferAmount = 0;

    for (let i = 0; i < winningCount; i++) {
      const item = items[i];
      const bid = topBids[i];

      // Transfer item ownership
      item.ownerId = bid.userId;
      item.updatedAt = new Date();
      await item.save({ session });

      // Deduct from winner's wallet
      await this.walletModel.updateOne(
        { userId: bid.userId },
        {
          $inc: {
            balance: -bid.amount,
            lockedBalance: -bid.amount,
          },
        },
        { session },
      );

      // Create transaction record
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

      totalTransferAmount += bid.amount;
    }

    // Credit seller's wallet
    if (totalTransferAmount > 0) {
      await this.walletModel.updateOne(
        { userId: auction.sellerId },
        { $inc: { balance: totalTransferAmount } },
        { session },
      );
    }
  }

  private async _processLosers(
    auction: AuctionDocument,
    session: ClientSession,
  ): Promise<void> {
    // Mark remaining active bids as lost
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

    // Unlock funds for losers
    const losingBids = await this.bidModel
      .find({ auctionId: auction._id, status: BidStatus.LOST })
      .session(session)
      .exec();

    for (const bid of losingBids) {
      await this.walletModel.updateOne(
        { userId: bid.userId },
        { $inc: { lockedBalance: -bid.amount } },
        { session },
      );
    }

    this.logger.log(
      `Unlocked funds for ${losingBids.length} losing bids in auction ${auction._id}`,
    );
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
