import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export enum AuctionStatus {
  ACTIVE = 'active',
  ENDED = 'ended',
  CANCELLED = 'cancelled',
}

@Schema({ _id: false })
export class AuctionSettings {
  @Prop({ required: true })
  antisniping?: number; // in seconds

  @Prop({ required: false })
  minBid?: number;

  @Prop({ required: false })
  minBidDifference?: number;
}

@Schema({ _id: false })
export class AuctionRound {
  @Prop({ required: true })
  startTime: Date;

  @Prop({ required: true })
  endTime: Date;

  @Prop({ type: [Types.ObjectId], ref: 'Item', required: true })
  itemIds: Types.ObjectId[];
}

export type AuctionDocument = HydratedDocument<Auction>;

@Schema({ timestamps: true })
export class Auction {
  @Prop({ required: true })
  name: string;

  @Prop({
    required: true,
    enum: Object.values(AuctionStatus),
    default: AuctionStatus.ACTIVE,
  })
  status: AuctionStatus;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  sellerId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Wallet', required: true })
  sellerWalletId: Types.ObjectId;

  @Prop({ type: AuctionSettings, required: true })
  settings: AuctionSettings;

  @Prop({ type: [AuctionRound], required: true })
  rounds: AuctionRound[];

  createdAt: Date;
  updatedAt: Date;
}

export const AuctionSchema = SchemaFactory.createForClass(Auction);
