import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export enum TransactionType {
  BID = 'BID',
  INCREASE_BID = 'INCREASE_BID',
  TRANSFER = 'TRANSFER',
}

export enum RelatedEntityType {
  AUCTION = 'AUCTION',
}

export type TransactionDocument = HydratedDocument<Transaction>;

@Schema({ timestamps: true })
export class Transaction {
  @Prop({ type: Types.ObjectId, ref: 'Wallet', required: true })
  fromWalletId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Wallet', required: false })
  toWalletId: Types.ObjectId | null;

  @Prop({ required: true })
  amount: number;

  @Prop({
    required: true,
    enum: Object.values(TransactionType),
  })
  type: TransactionType;

  @Prop({ type: Types.ObjectId, required: false })
  relatedEntityId: Types.ObjectId | null;

  @Prop({
    required: false,
    enum: Object.values(RelatedEntityType),
  })
  relatedEntityType: RelatedEntityType | null;

  @Prop({ type: Object, required: false, default: {} })
  metadata: Record<string, any>;

  @Prop({ required: true })
  description: string;

  createdAt: Date;
  updatedAt: Date;
}

export const TransactionSchema = SchemaFactory.createForClass(Transaction);

// Create compound indexes for efficient querying
TransactionSchema.index({ fromWalletId: 1, type: 1 });
TransactionSchema.index({ toWalletId: 1, type: 1 });
TransactionSchema.index({ relatedEntityId: 1, relatedEntityType: 1 });
