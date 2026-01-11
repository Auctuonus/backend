import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { InitData } from '@tma.js/init-data-node';
import * as bcrypt from 'bcrypt';
import { User, UserDocument } from '../models/user.schema';
import configuration from '../config';
import { Wallet, WalletDocument } from 'src/models';

interface JwtPayload {
  userId: string;
  telegramId: number;
  type: 'access' | 'refresh';
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Wallet.name) private walletModel: Model<WalletDocument>,
    private jwtService: JwtService,
  ) {}

  async loginWithTelegram(initData: InitData): Promise<TokenPair> {
    if (!initData.user) {
      throw new UnauthorizedException('User data not found in initData');
    }

    const telegramId = initData.user.id;

    // Find or create user
    let user = await this.userModel.findOne({ telegramId }).exec();

    if (!user) {
      user = await this.userModel.create({ telegramId });
      await this.walletModel.create({ userId: user._id });
    }

    return this.generateTokens(user._id.toString(), telegramId);
  }

  async loginWithPassword(
    telegramId: number,
    password: string,
  ): Promise<TokenPair> {
    // Find user by telegram ID
    const user = await this.userModel.findOne({ telegramId }).exec();

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if user has a password set
    if (!user.hashedPassword) {
      // If no password is set, set it now (first time login with password)
      const hashedPassword = await bcrypt.hash(password, 10);
      user.hashedPassword = hashedPassword;
      await user.save();
    } else {
      // Verify password - hashedPassword is guaranteed to be a string here
      const isPasswordValid = await bcrypt.compare(
        password,
        user.hashedPassword,
      );

      if (!isPasswordValid) {
        throw new UnauthorizedException('Invalid credentials');
      }
    }

    return this.generateTokens(user._id.toString(), telegramId);
  }

  refreshTokens(refreshToken: string): TokenPair {
    try {
      const payload = this.verifyToken(refreshToken, 'refresh');
      return this.generateTokens(payload.userId, payload.telegramId);
    } catch (error) {
      throw new UnauthorizedException(
        `Invalid refresh token: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  generateTokens(userId: string, telegramId: number): TokenPair {
    const config = configuration();

    const accessPayload: JwtPayload = {
      userId,
      telegramId,
      type: 'access',
    };

    const refreshPayload: JwtPayload = {
      userId,
      telegramId,
      type: 'refresh',
    };

    const accessToken = this.jwtService.sign(accessPayload, {
      expiresIn: config.jwt.authExpiresIn,
    });

    const refreshToken = this.jwtService.sign(refreshPayload, {
      expiresIn: config.jwt.refreshTokenExpiresIn,
    });

    return {
      accessToken,
      refreshToken,
    };
  }

  verifyToken(token: string, expectedType: 'access' | 'refresh'): JwtPayload {
    try {
      const payload = this.jwtService.verify<JwtPayload>(token);

      if (payload.type !== expectedType) {
        throw new UnauthorizedException(
          `Invalid token type. Expected ${expectedType}, got ${payload.type}`,
        );
      }

      return payload;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException(
        `Token verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}
