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
    if (winningCount === 0) return;

    const now = new Date();
    let totalTransferAmount = 0;

    // Prepare bulk operations
    const itemBulkOps: any[] = [];
    const walletBulkOps: any[] = [];
    const transactionDocs: any[] = [];

    for (let i = 0; i < winningCount; i++) {
      const item = items[i];
      const bid = topBids[i];

      // Transfer item ownership
      itemBulkOps.push({
        updateOne: {
          filter: { _id: item._id },
          update: { $set: { ownerId: bid.userId, updatedAt: now } },
        },
      });

      // Deduct from winner's wallet
      walletBulkOps.push({
        updateOne: {
          filter: { userId: bid.userId },
          update: { $inc: { balance: -bid.amount, lockedBalance: -bid.amount } },
        },
      });

      // Prepare transaction record
      transactionDocs.push({
        fromWalletId: bid.userId,
        toWalletId: auction.sellerWalletId,
        amount: bid.amount,
        type: TransactionType.TRANSFER,
        relatedEntityId: auction._id,
        relatedEntityType: RelatedEntityType.AUCTION,
        description: 'Auction win transfer',
      });

      totalTransferAmount += bid.amount;
    }

    // Execute bulk operations
    if (itemBulkOps.length > 0) {
      await this.itemModel.bulkWrite(itemBulkOps, { session });
    }

    if (walletBulkOps.length > 0) {
      // Add seller credit to wallet bulk ops
      walletBulkOps.push({
        updateOne: {
          filter: { userId: auction.sellerId },
          update: { $inc: { balance: totalTransferAmount } },
        },
      });
      await this.walletModel.bulkWrite(walletBulkOps, { session });
    }

    if (transactionDocs.length > 0) {
      await this.transactionModel.insertMany(transactionDocs, { session });
    }
  }

  private async _processLosers(
    auction: AuctionDocument,
    session: ClientSession,
  ): Promise<void> {
    // Get losing bids before updating status
    const losingBids = await this.bidModel
      .find({ auctionId: auction._id, status: BidStatus.ACTIVE })
      .session(session)
      .exec();

    if (losingBids.length === 0) return;

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

    // Unlock funds for losers using bulkWrite
    const walletBulkOps = losingBids.map((bid) => ({
      updateOne: {
        filter: { userId: bid.userId },
        update: { $inc: { lockedBalance: -bid.amount } },
      },
    }));

    await this.walletModel.bulkWrite(walletBulkOps, { session });

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
