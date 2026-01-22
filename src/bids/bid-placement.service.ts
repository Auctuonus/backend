import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Types, ClientSession, Connection } from 'mongoose';
import { Bid, BidDocument, BidStatus } from '../models/bid.schema';
import {
  Auction,
  AuctionDocument,
  AuctionStatus,
} from '../models/auction.schema';
import { Wallet, WalletDocument } from '../models/wallet.schema';
import {
  Transaction,
  TransactionDocument,
  TransactionType,
  RelatedEntityType,
} from '../models/transaction.schema';
import { PlaceBidResult } from './interfaces/bid-response.interface';
import { ExtendBidDto } from './dto/place-bid.dto';
import { DistributedLockService } from '../redis/distributed-lock.service';

@Injectable()
export class BidPlacementService {
  private readonly logger = new Logger(BidPlacementService.name);

  constructor(
    @InjectModel(Bid.name) private bidModel: Model<BidDocument>,
    @InjectModel(Auction.name) private auctionModel: Model<AuctionDocument>,
    @InjectModel(Wallet.name) private walletModel: Model<WalletDocument>,
    @InjectModel(Transaction.name)
    private transactionModel: Model<TransactionDocument>,
    @InjectConnection() private connection: Connection,
    private distributedLockService: DistributedLockService,
  ) {}

  async placeBid(placeBidDto: ExtendBidDto): Promise<PlaceBidResult> {
    // Acquire distributed lock for auction and user wallet to prevent race conditions
    const auctionLockKey = `auction:${placeBidDto.auctionId}`;
    const userLockKey = `user:${placeBidDto.userId}:bid`;

    return this.distributedLockService.withLock(
      auctionLockKey,
      () =>
        this.distributedLockService.withLock(
          userLockKey,
          () => this._placeBidWithTransaction(placeBidDto),
          { ttlMs: 15000, maxRetries: 100 },
        ),
      { ttlMs: 30000, maxRetries: 200 },
    );
  }

  private async _placeBidWithTransaction(
    placeBidDto: ExtendBidDto,
  ): Promise<PlaceBidResult> {
    const session: ClientSession = await this.connection.startSession();
    session.startTransaction();

    try {
      const result = await this._placeBid(placeBidDto, session);
      await session.commitTransaction();
      return result;
    } catch (error) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      this.logger.error('Error placing bid:', error);
      return { status: 'error' };
    } finally {
      await session.endSession();
    }
  }

  private async _placeBid(
    placeBidDto: ExtendBidDto,
    session: ClientSession,
  ): Promise<PlaceBidResult> {
    const now = new Date();
    const auction = await this._getAuction(placeBidDto, now, session);

    const myBid = await this._getMyBit(placeBidDto, auction, session);

    const myWallet = await this._getMyWallet(placeBidDto, session);

    if (myBid) {
      await this._updateBid(placeBidDto, auction, myWallet, myBid, session);
    } else {
      await this._createBid(placeBidDto, auction, myWallet, session);
    }

    // Update auction time
    const newEndDate = await this._checkAntisniping(auction, now, session);

    return {
      status: 'ok',
      data: {
        amount: placeBidDto.amount,
        newEndDate: newEndDate,
      },
    };
  }

  private async _updateBid(
    placeBidDto: ExtendBidDto,
    auction: AuctionDocument,
    myWallet: WalletDocument,
    myBid: BidDocument,
    session: ClientSession,
  ): Promise<void> {
    const amountDifference = placeBidDto.amount - myBid.amount;

    // Update wallet
    const freeBalance = myWallet.balance - myWallet.lockedBalance;
    if (freeBalance < amountDifference) {
      throw new BadRequestException('Not enough balance');
    }
    await this.walletModel.updateOne(
      { userId: new Types.ObjectId(placeBidDto.userId) },
      { $inc: { lockedBalance: amountDifference } },
      { session },
    );

    // Update bid
    myBid.amount = placeBidDto.amount;
    myBid.updatedAt = new Date();
    await myBid.save({ session });

    // Create transaction
    await this.transactionModel.create(
      [
        {
          fromWalletId: myWallet._id,
          amount: amountDifference,
          type: TransactionType.INCREASE_BID,
          relatedEntityId: auction._id,
          relatedEntityType: RelatedEntityType.AUCTION,
          description: 'Bid increase',
        },
      ],
      { session },
    );
  }

  private async _createBid(
    placeBidDto: ExtendBidDto,
    auction: AuctionDocument,
    myWallet: WalletDocument,
    session: ClientSession,
  ): Promise<void> {
    // Update wallet
    const freeBalance = myWallet.balance - myWallet.lockedBalance;
    if (freeBalance < placeBidDto.amount) {
      throw new BadRequestException('Not enough balance');
    }
    await this.walletModel.updateOne(
      { userId: new Types.ObjectId(placeBidDto.userId) },
      { $inc: { lockedBalance: placeBidDto.amount } },
      { session },
    );

    // Create bid
    await this.bidModel.create(
      [
        {
          userId: new Types.ObjectId(placeBidDto.userId),
          auctionId: new Types.ObjectId(placeBidDto.auctionId),
          amount: placeBidDto.amount,
          status: BidStatus.ACTIVE,
        },
      ],
      { session },
    );

    // Create transaction
    await this.transactionModel.create(
      [
        {
          fromWalletId: myWallet._id,
          amount: placeBidDto.amount,
          type: TransactionType.BID,
          relatedEntityId: auction._id,
          relatedEntityType: RelatedEntityType.AUCTION,
          description: 'Bid placement',
        },
      ],
      { session },
    );
  }

  private async _checkAntisniping(
    auction: AuctionDocument,
    now: Date,
    session: ClientSession,
  ): Promise<Date> {
    if (auction.settings.antisniping) {
      let nowWithDelay = new Date(
        now.getTime() + 1000 * auction.settings.antisniping,
      );
      auction.rounds
        .filter((round) => now < round.endTime)
        .forEach((round) => {
          if (nowWithDelay > round.endTime) {
            round.endTime = nowWithDelay;
            nowWithDelay = new Date(
              nowWithDelay.getTime() + 1000 * auction.settings.antisniping,
            );
          }
        });
    }

    const newEndDate = auction.rounds.find(
      (round) => round.endTime > now,
    )?.endTime;
    if (!newEndDate) {
      throw new BadRequestException('Auction is ended');
    }
    await this.auctionModel.updateOne(
      { _id: auction._id },
      { $set: { rounds: auction.rounds } },
      { session },
    );
    return newEndDate;
  }

  private async _getAuction(
    placeBidDto: ExtendBidDto,
    now: Date,
    session: ClientSession,
  ): Promise<AuctionDocument> {
    // 1. Find and validate auction
    const auction = await this.auctionModel
      .findById(new Types.ObjectId(placeBidDto.auctionId))
      .session(session)
      .exec();

    if (!auction) {
      throw new NotFoundException('Auction not found');
    }

    if (
      auction.status !== AuctionStatus.ACTIVE ||
      auction.rounds.every((round) => round.endTime < now) ||
      auction.rounds.every((round) => round.status !== AuctionStatus.ACTIVE)
    ) {
      throw new BadRequestException('Auction is ended');
    }

    if (placeBidDto.amount < auction.settings.minBid) {
      await session.abortTransaction();
      throw new BadRequestException('Bid amount is less than the minimum bid');
    }

    return auction;
  }

  private async _getMyBit(
    placeBidDto: ExtendBidDto,
    auction: AuctionDocument,
    session: ClientSession,
  ): Promise<BidDocument | null> {
    const myBid = await this.bidModel
      .findOne({
        auctionId: new Types.ObjectId(placeBidDto.auctionId),
        userId: new Types.ObjectId(placeBidDto.userId),
        status: BidStatus.ACTIVE,
      })
      .sort({ amount: -1 })
      .session(session)
      .exec();

    if (!myBid) {
      return null;
    }

    if (myBid.amount >= placeBidDto.amount) {
      throw new BadRequestException('Bid amount is less than the current bid');
    }

    if (placeBidDto.amount < auction.settings.minBid) {
      throw new BadRequestException('Bid amount is less than the minimum bid');
    }

    if (placeBidDto.amount < myBid.amount + auction.settings.minBidDifference) {
      throw new BadRequestException(
        'Bid amount is less than the minimum bid difference',
      );
    }

    return myBid;
  }

  private async _getMyWallet(
    placeBidDto: ExtendBidDto,
    session: ClientSession,
  ): Promise<WalletDocument> {
    const myWallet = await this.walletModel
      .findOne({
        userId: new Types.ObjectId(placeBidDto.userId),
      })
      .session(session)
      .exec();
    if (!myWallet) {
      throw new NotFoundException('Wallet not found');
    }
    return myWallet;
  }
}
