import { Controller, Post, Body, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BidPlacementService } from './bid-placement.service';
import { BidQueryService } from './bid-query.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../auth/decorators/user.decorator';
import { PlaceBidDto, ExtendBidDto } from './dto/place-bid.dto';
import {
  PlaceBidResult,
  MyBidsResponse,
  AuctionBidsResponse,
} from './interfaces/bid-response.interface';

@ApiTags('bids')
@Controller('bids')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT')
export class BidController {
  constructor(
    private readonly bidPlacementService: BidPlacementService,
    private readonly bidQueryService: BidQueryService,
  ) {}

  @Post('set_bid')
  async placeBid(
    @User('id') userId: string,
    @Body() dto: PlaceBidDto,
  ): Promise<PlaceBidResult> {
    return this.bidPlacementService.placeBid({
      userId,
      ...dto,
    } as ExtendBidDto);
  }

  @Post('get_my')
  async getMyBids(@User('id') userId: string): Promise<MyBidsResponse> {
    return this.bidQueryService.getMyBids(userId);
  }

  @Post('get_by_auction/:auction_id')
  async getBidsByAuction(
    @User('id') userId: string,
    @Param('auction_id') auctionId: string,
  ): Promise<AuctionBidsResponse> {
    return this.bidQueryService.getBidsByAuction(auctionId, userId);
  }
}
