import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export enum AuctionStatus {
  ACTIVE = 'active',
  ENDED = 'ended',
  CANCELLED = 'cancelled',
}

export enum RoundProcessingStatus {
  PENDING = 'pending',           // Раунд ещё не начался
  ACTIVE = 'active',             // Раунд активен, принимаются ставки
  PROCESSING_WINNERS = 'processing_winners',     // Определяем победителей
  PROCESSING_TRANSFERS = 'processing_transfers', // Переводим средства
  PROCESSING_LOSERS = 'processing_losers',       // Разблокируем средства проигравших
  COMPLETED = 'completed',       // Обработка завершена
  FAILED = 'failed',             // Ошибка обработки
}

export enum AuctionProcessingStage {
  DETERMINE_WINNERS = 'determine_winners',   // Stage 1: Определение победителей
  TRANSFER_ITEMS = 'transfer_items',         // Stage 2: Передача ownership предметов
  PROCESS_PAYMENTS = 'process_payments',     // Stage 3: Финансовые операции
  REFUND_LOSERS = 'refund_losers',           // Stage 4: Разблокировка средств проигравших
  FINALIZE = 'finalize',                     // Stage 5: Финализация статусов
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

  @Prop({
    required: true,
    enum: Object.values(AuctionStatus),
    default: AuctionStatus.ACTIVE,
  })
  status: AuctionStatus;

  @Prop({
    required: false,
    enum: Object.values(RoundProcessingStatus),
  })
  processingStatus?: RoundProcessingStatus;

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

// Index for listing auctions by status
AuctionSchema.index({ status: 1 });

// Index for finding seller's auctions
AuctionSchema.index({ sellerId: 1, status: 1 });
