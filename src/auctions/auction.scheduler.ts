import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { randomUUID } from 'crypto';
import {
  Auction,
  AuctionDocument,
  AuctionStatus,
} from '../models/auction.schema';

@Injectable()
export class AuctionSchedulerService {
  private readonly logger = new Logger(AuctionSchedulerService.name);

  constructor(
    @InjectModel(Auction.name) private auctionModel: Model<AuctionDocument>,
    private amqpConnection: AmqpConnection,
  ) {}

  @Interval(10000) // Check every 10 seconds
  async checkEndedAuctions() {
    const now = new Date();

    // Find active auctions with ended rounds that haven't been processed
    const endedAuctions = await this.auctionModel
      .find({
        status: AuctionStatus.ACTIVE,
        'rounds.endTime': { $lt: now },
        'rounds.status': AuctionStatus.ACTIVE,
      })
      .lean()
      .exec();

    if (endedAuctions.length === 0) {
      return;
    }

    this.logger.log(
      `Found ${endedAuctions.length} auction(s) with ended rounds`,
    );

    for (const auction of endedAuctions) {
      const jobMessage = {
        id: randomUUID(),
        auctionId: String(auction._id),
        publishedAt: new Date().toISOString(),
      };

      await this.amqpConnection.publish('delayed.ex', 'jobs', jobMessage, {
        headers: {
          'x-delay': 0,
        },
      });

      this.logger.log(`Sent processing message for auction ${auction._id}`);
    }
  }
}
