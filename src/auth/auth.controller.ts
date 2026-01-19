import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiProperty,
} from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';
import { TelegramAuthGuard, TelegramInitData } from '../auth';
import { AuthService } from '../auth/auth.service';
import type { InitData } from '@tma.js/init-data-node';
import type { TokenPair } from '../auth/auth.service';
import { LoginPasswordDto } from './dto/login-password.dto';

class RefreshTokenDto {
  @ApiProperty({
    description: 'Refresh token',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('tg')
  @UseGuards(TelegramAuthGuard)
  @ApiBearerAuth('TMA')
  @ApiOperation({ summary: 'Authenticate with Telegram and get JWT tokens' })
  @ApiResponse({
    status: 200,
    description: 'Returns access and refresh tokens',
    schema: {
      properties: {
        accessToken: { type: 'string' },
        refreshToken: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  loginWithTelegram(
    @TelegramInitData() initData: InitData,
  ): Promise<TokenPair> {
    return this.authService.loginWithTelegram(initData);
  }

  @Post('password')
  @ApiOperation({
    summary: 'Authenticate with Telegram ID and password',
    description:
      'Login using Telegram ID as login and password. Password will be set on first login if not already set.',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns access and refresh tokens',
    schema: {
      properties: {
        accessToken: { type: 'string' },
        refreshToken: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  loginWithPassword(@Body() body: LoginPasswordDto): Promise<TokenPair> {
    return this.authService.loginWithPassword(body.telegramId, body.password);
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Refresh access token using refresh token' })
  @ApiResponse({
    status: 200,
    description: 'Returns new access and refresh tokens',
    schema: {
      properties: {
        accessToken: { type: 'string' },
        refreshToken: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Invalid refresh token' })
  refreshTokens(@Body() body: RefreshTokenDto): TokenPair {
    return this.authService.refreshTokens(body.refreshToken);
  }
}
