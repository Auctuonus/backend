import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ItemDocument = HydratedDocument<Item>;

@Schema({ timestamps: true })
export class Item {
  @Prop({ required: true })
  num: number;

  @Prop({ required: true })
  collectionName: string;

  @Prop({ required: true })
  value: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  ownerId: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

export const ItemSchema = SchemaFactory.createForClass(Item);

// Create a unique compound index for collectionName_num pattern
ItemSchema.index({ collectionName: 1, num: 1 }, { unique: true });
