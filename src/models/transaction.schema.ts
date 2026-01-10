import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type TransactionDocument = HydratedDocument<Transaction>;

@Schema({ timestamps: true })
export class Transaction {
  @Prop({ type: Types.ObjectId, ref: 'Wallet', required: true })
  fromWalletId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Wallet', required: true })
  toWalletId: Types.ObjectId;

  @Prop({ required: true })
  amount: number;

  createdAt?: Date;
  updatedAt?: Date;
}

export const TransactionSchema = SchemaFactory.createForClass(Transaction);
