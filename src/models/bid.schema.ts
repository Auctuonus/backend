import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export enum BidStatus {
  ACTIVE = 'active',
  WON = 'won',
  LOST = 'lost',
}

export type BidDocument = HydratedDocument<Bid>;

@Schema({ timestamps: true })
export class Bid {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Auction', required: true })
  auctionId: Types.ObjectId;

  @Prop({ required: true })
  amount: number;

  @Prop({
    required: true,
    enum: Object.values(BidStatus),
    default: BidStatus.ACTIVE,
  })
  status: BidStatus;

  createdAt?: Date;
  updatedAt?: Date;
}

export const BidSchema = SchemaFactory.createForClass(Bid);
