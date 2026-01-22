import {
  IsOptional,
  IsEnum,
  IsString,
  ValidateNested,
  IsInt,
  Min,
  IsUUID,
  IsDate,
  IsMongoId,
  IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AuctionStatus } from '../models/auction.schema';

export class AuctionFiltersDto {
  @IsOptional()
  @IsEnum(AuctionStatus, { each: true })
  status?: AuctionStatus[];

  @IsOptional()
  @IsString()
  sellerId?: string;
}

export class PaginationDto {
  @IsInt()
  @Min(0)
  page: number;

  @IsInt()
  @Min(1)
  pageSize: number;
}

export class GetAuctionListDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => AuctionFiltersDto)
  filters?: AuctionFiltersDto;

  @ValidateNested()
  @Type(() => PaginationDto)
  pagination: PaginationDto;
}

export class JobMessage {
  @IsUUID()
  id: string;

  @IsMongoId()
  auctionId: string;

  @IsDate()
  publishedAt: Date;
}

export class ProcessingJobMessage {
  @IsUUID()
  id: string;

  @IsMongoId()
  auctionId: string;

  @IsNumber()
  roundIndex: number;

  @IsString()
  stage: string;

  @IsDate()
  publishedAt: Date;
}
