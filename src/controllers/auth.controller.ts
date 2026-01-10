import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { TelegramAuthGuard, TelegramInitData } from '../auth';
import type { InitData } from '@tma.js/init-data-node';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  @Get('me')
  @UseGuards(TelegramAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user information from Telegram' })
  @ApiResponse({
    status: 200,
    description: 'Returns the authenticated user information',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getCurrentUser(@TelegramInitData() initData: InitData) {
    return {
      user: initData.user,
      authDate: initData.auth_date,
      hash: initData.hash,
      startParam: initData.start_param,
    };
  }

  @Get('validate')
  @UseGuards(TelegramAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Validate Telegram authentication' })
  @ApiResponse({ status: 200, description: 'Authentication is valid' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async validateAuth(@TelegramInitData() initData: InitData) {
    return {
      valid: true,
      userId: initData.user?.id,
      username: initData.user?.username,
    };
  }
}
