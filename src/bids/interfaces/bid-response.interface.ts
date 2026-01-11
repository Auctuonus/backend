import { BidStatus } from '../../models/bid.schema';

export interface BidResponse {
  id: string;
  userId: string;
  auctionId: string;
  amount: number;
  status: BidStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlaceBidResult {
  status: 'ok' | 'not_enough' | 'error';
  data?: {
    amount: number;
    newEndDate: Date;
  };
}

export interface MyBidsResponse {
  bids: BidResponse[];
}

export interface AuctionBidsResponse {
  my_bids: BidResponse | null;
  top_bids: BidResponse[];
}
