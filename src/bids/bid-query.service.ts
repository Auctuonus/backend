import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Bid, BidDocument, BidStatus } from '../models/bid.schema';
import {
  MyBidsResponse,
  AuctionBidsResponse,
  BidResponse,
} from './interfaces/bid-response.interface';

@Injectable()
export class BidQueryService {
  constructor(@InjectModel(Bid.name) private bidModel: Model<BidDocument>) {}

  async getMyBids(userId: string): Promise<MyBidsResponse> {
    const bids = await this.bidModel
      .find({ userId: new Types.ObjectId(userId) })
      .lean()
      .exec();

    return {
      bids: bids.map((bid) => this.mapBidToResponse(bid as BidDocument)),
    };
  }

  async getBidsByAuction(
    auctionId: string,
    userId: string,
  ): Promise<AuctionBidsResponse> {
    const userObjectId = new Types.ObjectId(userId);
    const auctionObjectId = new Types.ObjectId(auctionId);

    // Find user's most recent bid on this auction
    const myBid = await this.bidModel
      .findOne({
        userId: userObjectId,
        auctionId: auctionObjectId,
        status: BidStatus.ACTIVE,
      })
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    // Find top 10 bids for this auction
    const topBids = await this.bidModel
      .find({
        auctionId: auctionObjectId,
        status: BidStatus.ACTIVE,
      })
      .sort({ amount: -1 })
      .limit(10)
      .lean()
      .exec();

    return {
      my_bids: myBid ? this.mapBidToResponse(myBid as BidDocument) : null,
      top_bids: topBids.map((bid) => this.mapBidToResponse(bid as BidDocument)),
    };
  }

  private mapBidToResponse(bid: BidDocument): BidResponse {
    return {
      id: bid._id.toString(),
      userId: bid.userId.toString(),
      auctionId: bid.auctionId.toString(),
      amount: bid.amount,
      status: bid.status,
      createdAt: bid.createdAt,
      updatedAt: bid.updatedAt,
    };
  }
}
