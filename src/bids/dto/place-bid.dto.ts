import { IsString, IsNotEmpty, IsInt, Min, IsUUID } from 'class-validator';

export class PlaceBidDto {
  @IsUUID()
  @IsNotEmpty()
  auctionId: string;

  @IsInt()
  @Min(1)
  amount: number;
}

export class ExtendBidDto {
  @IsString()
  @IsUUID()
  userId: string;

  @IsString()
  @IsUUID()
  auctionId: string;

  @IsInt()
  @Min(1)
  amount: number;
}
