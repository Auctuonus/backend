import { IsString, IsNotEmpty, IsInt, Min, IsMongoId } from 'class-validator';

export class PlaceBidDto {
  @IsMongoId()
  @IsNotEmpty()
  auctionId: string;

  @IsInt()
  @Min(1)
  amount: number;
}

export class ExtendBidDto {
  @IsString()
  @IsMongoId()
  userId: string;

  @IsString()
  @IsMongoId()
  auctionId: string;

  @IsInt()
  @Min(1)
  amount: number;
}
