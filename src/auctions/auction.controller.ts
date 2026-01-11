import {
  Controller,
  Post,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuctionService } from './auction.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetAuctionListDto } from './dto';
import {
  AuctionListResponse,
  AuctionDetailResponse,
} from './interfaces/auction-response.interface';

@ApiTags('auctions')
@Controller('auctions')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT')
export class AuctionController {
  constructor(private readonly auctionService: AuctionService) {}

  @Post('get_list')
  async getList(@Body() dto: GetAuctionListDto): Promise<AuctionListResponse> {
    if (!dto.pagination) {
      dto.pagination = {
        page: 1,
        pageSize: 10,
      };
    }
    return this.auctionService.getAuctionList(dto.filters, dto.pagination);
  }

  @Post('get/:auction_id')
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(300000) // 5 minutes
  async getById(
    @Param('auction_id') auctionId: string,
  ): Promise<AuctionDetailResponse> {
    return this.auctionService.getAuctionById(auctionId);
  }
}
