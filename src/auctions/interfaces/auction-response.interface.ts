import { AuctionStatus } from '../../models/auction.schema';

export interface AuctionSettingsResponse {
  antisniping?: number;
  minBid: number;
  minBidDifference: number;
}

export interface AuctionItemResponse {
  id: string;
  num: number;
  collectionName: string;
  value: string;
  ownerId: string;
}

export interface AuctionRoundResponse {
  startTime: Date;
  endTime: Date;
  itemIds: string[];
  items?: AuctionItemResponse[];
}

export interface AuctionResponse {
  id: string;
  status: AuctionStatus;
  sellerId: string;
  sellerWalletId: string;
  settings: AuctionSettingsResponse;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuctionListResponse {
  total: number;
  pagination: {
    page: number;
    pageSize: number;
  };
  auctions: AuctionResponse[];
}

export interface AuctionDetailResponse {
  auction: AuctionResponse & {
    rounds: AuctionRoundResponse[];
  };
}
