import { AmqpConnection, Nack, RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { Injectable, Logger } from '@nestjs/common';
import { JobMessage, ProcessingJobMessage } from './dto';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import {
  Auction,
  AuctionDocument,
  AuctionRound,
  AuctionStatus,
  AuctionProcessingStage,
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
import { randomUUID } from 'crypto';

export class DataIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataIntegrityError';
  }
}

@Injectable()
export class AuctionProcessingService {
  private readonly logger = new Logger(AuctionProcessingService.name);

  private readonly STAGE_ORDER: AuctionProcessingStage[] = [
    AuctionProcessingStage.DETERMINE_WINNERS,
    AuctionProcessingStage.TRANSFER_ITEMS,
    AuctionProcessingStage.PROCESS_PAYMENTS,
    AuctionProcessingStage.REFUND_LOSERS,
    AuctionProcessingStage.FINALIZE,
  ];

  constructor(
    @InjectConnection() private connection: Connection,
    @InjectModel(Auction.name) private auctionModel: Model<AuctionDocument>,
    @InjectModel(Item.name) private itemModel: Model<ItemDocument>,
    @InjectModel(Bid.name) private bidModel: Model<BidDocument>,
    @InjectModel(Wallet.name) private walletModel: Model<WalletDocument>,
    @InjectModel(Transaction.name)
    private transactionModel: Model<TransactionDocument>,
    private distributedLockService: DistributedLockService,
    private amqpConnection: AmqpConnection,
  ) {}

  // ============================================================================
  // INITIAL TRIGGER HANDLER (from delayed queue by timer)
  // ============================================================================

  @RabbitSubscribe({
    exchange: 'delayed.ex',
    routingKey: 'jobs',
    queue: 'jobs.q',
    queueOptions: { durable: true },
  })
  async processAuctionTrigger(msg: JobMessage) {
    const auctionLockKey = `auction:${msg.auctionId}`;
    const startTime = Date.now();
    const publishedAt = new Date(msg.publishedAt).getTime();
    const queueDelayMs = startTime - publishedAt;

    this.logger.log(
      `Auction trigger received ${msg.auctionId}, queue delay: ${queueDelayMs}ms, message id: ${msg.id}`,
    );

    if (queueDelayMs > 5000) {
      this.logger.warn(
        `High queue delay detected for auction ${msg.auctionId}: ${queueDelayMs}ms`,
      );
    }

    try {
      const result = await this.distributedLockService.withLock(
        auctionLockKey,
        () => this._initializeProcessing(msg),
      );

      const processingTimeMs = Date.now() - startTime;
      this.logger.log(
        `Auction ${msg.auctionId} trigger processed in ${processingTimeMs}ms`,
      );

      return result;
    } catch (error) {
      const processingTimeMs = Date.now() - startTime;
      this.logger.error(
        `Failed to process auction trigger ${msg.auctionId} after ${processingTimeMs}ms:`,
        error,
      );
      return new Nack(true);
    }
  }

  private async _initializeProcessing(msg: JobMessage): Promise<Nack | null> {
    const session: ClientSession = await this.connection.startSession();
    session.startTransaction();

    try {
      const now = new Date();
      const auction = await this.auctionModel
        .findById(msg.auctionId)
        .session(session)
        .exec();

      if (!auction) {
        await session.abortTransaction();
        return new Nack(false);
      }

      if (auction.status !== AuctionStatus.ACTIVE) {
        await session.abortTransaction();
        return new Nack(false);
      }

      // Find rounds that need processing
      for (let roundIndex = 0; roundIndex < auction.rounds.length; roundIndex++) {
        const round = auction.rounds[roundIndex];
        if (round.status !== AuctionStatus.ACTIVE) continue;
        if (round.endTime >= now) continue;

        // Publish first stage for this round
        await this._publishNextStage(
          msg.auctionId,
          roundIndex,
          AuctionProcessingStage.DETERMINE_WINNERS,
        );
      }

      await session.commitTransaction();
      return null;
    } catch (error) {
      this.logger.error(error);
      await session.abortTransaction();
      if (error instanceof DataIntegrityError) {
        return new Nack(false);
      }
      return new Nack(true);
    } finally {
      await session.endSession();
    }
  }

  // ============================================================================
  // STAGED PROCESSING HANDLER
  // ============================================================================

  @RabbitSubscribe({
    exchange: 'delayed.ex',
    routingKey: 'auction.processing',
    queue: 'auction.processing.q',
    queueOptions: { durable: true },
  })
  async processStage(msg: ProcessingJobMessage) {
    const auctionLockKey = `auction:${msg.auctionId}`;
    const startTime = Date.now();

    this.logger.log(
      `Processing stage ${msg.stage} for auction ${msg.auctionId}, round ${msg.roundIndex}, message id: ${msg.id}`,
    );

    try {
      const result = await this.distributedLockService.withLock(
        auctionLockKey,
        () => this._executeStage(msg),
      );

      const processingTimeMs = Date.now() - startTime;
      this.logger.log(
        `Stage ${msg.stage} for auction ${msg.auctionId} completed in ${processingTimeMs}ms`,
      );

      return result;
    } catch (error) {
      const processingTimeMs = Date.now() - startTime;
      this.logger.error(
        `Failed to process stage ${msg.stage} for auction ${msg.auctionId} after ${processingTimeMs}ms:`,
        error,
      );
      return new Nack(true);
    }
  }

  private async _executeStage(msg: ProcessingJobMessage): Promise<Nack | null> {
    const session: ClientSession = await this.connection.startSession();
    session.startTransaction();

    try {
      const auction = await this.auctionModel
        .findById(msg.auctionId)
        .session(session)
        .exec();

      if (!auction) {
        throw new DataIntegrityError(`Auction ${msg.auctionId} not found`);
      }

      const round = auction.rounds[msg.roundIndex];
      if (!round) {
        throw new DataIntegrityError(
          `Round ${msg.roundIndex} not found for auction ${msg.auctionId}`,
        );
      }

      const stage = msg.stage as AuctionProcessingStage;
      const isLastRound = msg.roundIndex === auction.rounds.length - 1;

      // Execute the appropriate stage
      switch (stage) {
        case AuctionProcessingStage.DETERMINE_WINNERS:
          await this._stageDetermineWinners(auction, round, msg.roundIndex, session);
          break;

        case AuctionProcessingStage.TRANSFER_ITEMS:
          await this._stageTransferItems(auction, round, msg.roundIndex, session);
          break;

        case AuctionProcessingStage.PROCESS_PAYMENTS:
          await this._stageProcessPayments(auction, round, msg.roundIndex, session);
          break;

        case AuctionProcessingStage.REFUND_LOSERS:
          await this._stageRefundLosers(auction, msg.roundIndex, isLastRound, session);
          break;

        case AuctionProcessingStage.FINALIZE:
          await this._stageFinalize(auction, round, msg.roundIndex, isLastRound, session);
          break;

        default:
          throw new DataIntegrityError(`Unknown stage: ${stage}`);
      }

      await session.commitTransaction();

      // Publish next stage if exists
      const nextStage = this._getNextStage(stage, isLastRound);
      if (nextStage) {
        await this._publishNextStage(msg.auctionId, msg.roundIndex, nextStage);
      }

      return null;
    } catch (error) {
      this.logger.error(error);
      await session.abortTransaction();

      if (error instanceof DataIntegrityError) {
        return new Nack(false);
      }
      return new Nack(true);
    } finally {
      await session.endSession();
    }
  }

  // ============================================================================
  // STAGE IMPLEMENTATIONS
  // ============================================================================

  private async _stageDetermineWinners(
    auction: AuctionDocument,
    round: AuctionRound,
    roundIndex: number,
    session: ClientSession,
  ): Promise<void> {
    this.logger.log(`Stage DETERMINE_WINNERS for auction ${auction._id}, round ${roundIndex}`);

    await this._updateRoundProcessingStatus(
      auction,
      roundIndex,
      RoundProcessingStatus.PROCESSING_WINNERS,
      session,
    );

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
    }

    this.logger.log(
      `Determined ${topBids.length} winners for ${items.length} items in auction ${auction._id}`,
    );
  }

  private async _stageTransferItems(
    auction: AuctionDocument,
    round: AuctionRound,
    roundIndex: number,
    session: ClientSession,
  ): Promise<void> {
    this.logger.log(`Stage TRANSFER_ITEMS for auction ${auction._id}, round ${roundIndex}`);

    await this._updateRoundProcessingStatus(
      auction,
      roundIndex,
      RoundProcessingStatus.PROCESSING_TRANSFERS,
      session,
    );

    const { items, topBids } = await this._getWinningEntities(auction, round, session);
    const winningCount = Math.min(items.length, topBids.length);

    if (winningCount === 0) return;

    const now = new Date();
    const itemBulkOps = [];

    for (let i = 0; i < winningCount; i++) {
      const item = items[i];
      const bid = topBids[i];

      itemBulkOps.push({
        updateOne: {
          filter: { _id: item._id },
          update: { $set: { ownerId: bid.userId, updatedAt: now } },
        },
      });
    }

    if (itemBulkOps.length > 0) {
      await this.itemModel.bulkWrite(itemBulkOps, { session });
    }

    this.logger.log(`Transferred ${winningCount} items in auction ${auction._id}`);
  }

  private async _stageProcessPayments(
    auction: AuctionDocument,
    round: AuctionRound,
    roundIndex: number,
    session: ClientSession,
  ): Promise<void> {
    this.logger.log(`Stage PROCESS_PAYMENTS for auction ${auction._id}, round ${roundIndex}`);

    const { items, topBids } = await this._getWinningEntities(auction, round, session);
    const winningCount = Math.min(items.length, topBids.length);

    if (winningCount === 0) return;

    let totalTransferAmount = 0;
    const walletBulkOps: any[] = [];
    const transactionDocs: any[] = [];

    for (let i = 0; i < winningCount; i++) {
      const bid = topBids[i];

      walletBulkOps.push({
        updateOne: {
          filter: { userId: bid.userId },
          update: { $inc: { balance: -bid.amount, lockedBalance: -bid.amount } },
        },
      });

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

    if (walletBulkOps.length > 0) {
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

    this.logger.log(
      `Processed payments: ${totalTransferAmount} total for ${winningCount} winners in auction ${auction._id}`,
    );
  }

  private async _stageRefundLosers(
    auction: AuctionDocument,
    roundIndex: number,
    isLastRound: boolean,
    session: ClientSession,
  ): Promise<void> {
    this.logger.log(`Stage REFUND_LOSERS for auction ${auction._id}, round ${roundIndex}`);

    if (!isLastRound) {
      this.logger.log(`Skipping REFUND_LOSERS - not last round`);
      return;
    }

    await this._updateRoundProcessingStatus(
      auction,
      roundIndex,
      RoundProcessingStatus.PROCESSING_LOSERS,
      session,
    );

    const losingBids = await this.bidModel
      .find({ auctionId: auction._id, status: BidStatus.ACTIVE })
      .session(session)
      .exec();

    if (losingBids.length === 0) return;

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

  private async _stageFinalize(
    auction: AuctionDocument,
    round: AuctionRound,
    roundIndex: number,
    isLastRound: boolean,
    session: ClientSession,
  ): Promise<void> {
    this.logger.log(`Stage FINALIZE for auction ${auction._id}, round ${roundIndex}`);

    await this._updateRoundProcessingStatus(
      auction,
      roundIndex,
      RoundProcessingStatus.COMPLETED,
      session,
    );

    await this.auctionModel.updateOne(
      { _id: auction._id },
      {
        $set: {
          [`rounds.${roundIndex}.status`]: AuctionStatus.ENDED,
          ...(isLastRound && { status: AuctionStatus.ENDED }),
        },
      },
      { session },
    );

    this.logger.log(`Round ${roundIndex} for auction ${auction._id} finalized`);
  }

  // ============================================================================
  // TEST HELPER - runs all stages synchronously for testing
  // ============================================================================

  async processAuctionSync(msg: JobMessage): Promise<Nack | null> {
    const auctionLockKey = `auction:${msg.auctionId}`;

    try {
      return await this.distributedLockService.withLock(auctionLockKey, async () => {
        const session: ClientSession = await this.connection.startSession();
        session.startTransaction();

        try {
          const now = new Date();
          const auction = await this.auctionModel
            .findById(msg.auctionId)
            .session(session)
            .exec();

          if (!auction) {
            await session.abortTransaction();
            return new Nack(false);
          }

          if (auction.status !== AuctionStatus.ACTIVE) {
            await session.abortTransaction();
            return new Nack(false);
          }

          // Process all rounds that need processing
          for (let roundIndex = 0; roundIndex < auction.rounds.length; roundIndex++) {
            const round = auction.rounds[roundIndex];
            if (round.status !== AuctionStatus.ACTIVE) continue;
            if (round.endTime >= now) continue;

            const isLastRound = roundIndex === auction.rounds.length - 1;

            // Run all stages in sequence
            await this._stageDetermineWinners(auction, round, roundIndex, session);
            await this._stageTransferItems(auction, round, roundIndex, session);
            await this._stageProcessPayments(auction, round, roundIndex, session);
            if (isLastRound) {
              await this._stageRefundLosers(auction, roundIndex, isLastRound, session);
            }
            await this._stageFinalize(auction, round, roundIndex, isLastRound, session);
          }

          await session.commitTransaction();
          return null;
        } catch (error) {
          this.logger.error(error);
          await session.abortTransaction();
          if (error instanceof DataIntegrityError) {
            return new Nack(false);
          }
          return new Nack(true);
        } finally {
          await session.endSession();
        }
      });
    } catch (error) {
      this.logger.error(error);
      return new Nack(true);
    }
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private _getNextStage(
    currentStage: AuctionProcessingStage,
    isLastRound: boolean,
  ): AuctionProcessingStage | null {
    const currentIndex = this.STAGE_ORDER.indexOf(currentStage);
    if (currentIndex === -1) return null;

    // Skip REFUND_LOSERS if not last round
    let nextIndex = currentIndex + 1;
    if (
      nextIndex < this.STAGE_ORDER.length &&
      this.STAGE_ORDER[nextIndex] === AuctionProcessingStage.REFUND_LOSERS &&
      !isLastRound
    ) {
      nextIndex++;
    }

    if (nextIndex >= this.STAGE_ORDER.length) return null;
    return this.STAGE_ORDER[nextIndex];
  }

  private async _publishNextStage(
    auctionId: string,
    roundIndex: number,
    stage: AuctionProcessingStage,
  ): Promise<void> {
    const message: ProcessingJobMessage = {
      id: randomUUID(),
      auctionId,
      roundIndex,
      stage,
      publishedAt: new Date(),
    };

    await this.amqpConnection.publish('delayed.ex', 'auction.processing', message);

    this.logger.log(
      `Published next stage ${stage} for auction ${auctionId}, round ${roundIndex}`,
    );
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

  private async _getWinningEntities(
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
        status: BidStatus.WON,
      })
      .sort({ amount: -1 })
      .limit(items.length)
      .session(session)
      .exec();
    return { items, topBids };
  }
}
