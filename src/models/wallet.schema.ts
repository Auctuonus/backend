import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WalletDocument = HydratedDocument<Wallet>;

@Schema({ timestamps: true })
export class Wallet {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true, default: 0 })
  balance: number;

  @Prop({ required: true, default: 0 })
  lockedBalance: number;

  createdAt?: Date;
  updatedAt?: Date;
}

export const WalletSchema = SchemaFactory.createForClass(Wallet);
