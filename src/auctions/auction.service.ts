import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Auction,
  AuctionDocument,
  AuctionStatus,
  AuctionRound,
} from '../models/auction.schema';
import { Item, ItemDocument } from '../models/item.schema';
import {
  AuctionListResponse,
  AuctionDetailResponse,
  AuctionResponse,
  AuctionRoundResponse,
  AuctionItemResponse,
} from './interfaces/auction-response.interface';
import { AuctionFiltersDto, PaginationDto } from './dto';

@Injectable()
export class AuctionService {
  constructor(
    @InjectModel(Auction.name) private auctionModel: Model<AuctionDocument>,
    @InjectModel(Item.name) private itemModel: Model<ItemDocument>,
  ) {}

  async getAuctionList(
    filters: AuctionFiltersDto | undefined,
    pagination: PaginationDto,
  ): Promise<AuctionListResponse> {
    const query: any = {};

    // Apply filters
    if (filters?.status && filters.status.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      query.status = { $in: filters.status };
    } else {
      // Default to active auctions only
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      query.status = AuctionStatus.ACTIVE;
    }

    if (filters?.sellerId) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      query.sellerId = new Types.ObjectId(filters.sellerId);
    }

    // Calculate skip
    const skip = (pagination.page - 1) * pagination.pageSize;

    // Execute query with pagination

    const [auctions, total] = await Promise.all([
      this.auctionModel
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        .find(query)
        .skip(skip)
        .limit(pagination.pageSize)
        .lean()
        .exec(),
      this.auctionModel.countDocuments(query).exec(),
    ]);

    return {
      total,
      pagination: {
        page: pagination.page,
        pageSize: pagination.pageSize,
      },
      auctions: auctions.map((auction) =>
        this.mapAuctionToResponse(auction as AuctionDocument),
      ),
    };
  }

  async getAuctionById(id: string): Promise<AuctionDetailResponse> {
    const auction = await this.auctionModel.findById(id).lean().exec();

    if (!auction) {
      throw new NotFoundException('Auction not found');
    }

    const populatedRounds = await this.populateRoundsWithItems(auction.rounds);

    return {
      auction: {
        ...this.mapAuctionToResponse(auction),
        rounds: populatedRounds,
      },
    };
  }

  private async populateRoundsWithItems(
    rounds: AuctionRound[],
  ): Promise<AuctionRoundResponse[]> {
    const populatedRounds: AuctionRoundResponse[] = [];

    for (const round of rounds) {
      const items = await this.itemModel
        .find({ _id: { $in: round.itemIds } })
        .lean()
        .exec();

      const mappedItems: AuctionItemResponse[] = items.map((item) => ({
        id: `${item.collectionName}_${item.num}`,
        num: item.num,
        collectionName: item.collectionName,
        value: item.value,
        ownerId: item.ownerId.toString(),
      }));

      populatedRounds.push({
        startTime: round.startTime,
        endTime: round.endTime,
        itemIds: round.itemIds.map((id) => id.toString()),
        items: mappedItems,
      });
    }

    return populatedRounds;
  }

  private mapAuctionToResponse(auction: AuctionDocument): AuctionResponse {
    return {
      id: auction._id.toString(),
      status: auction.status,
      sellerId: auction.sellerId.toString(),
      sellerWalletId: auction.sellerWalletId.toString(),
      settings: {
        antisniping: auction.settings.antisniping,
        minBid: auction.settings.minBid,
        minBidDifference: auction.settings.minBidDifference,
      },
      createdAt: auction.createdAt,
      updatedAt: auction.updatedAt,
    };
  }
}
