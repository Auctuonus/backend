import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from '../models/user.schema';
import { Wallet, WalletDocument } from '../models/wallet.schema';

export interface UserWithWalletResponse {
  user: {
    id: string;
    telegramId: number;
    createdAt: Date;
    updatedAt: Date;
  };
  wallet: {
    id: string;
    userId: string;
    balance: number;
    lockedBalance: number;
    freeBalance: number;
    createdAt: Date;
    updatedAt: Date;
  };
}

@Injectable()
export class UserService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Wallet.name) private walletModel: Model<WalletDocument>,
  ) {}

  async getUserWithWallet(userId: string): Promise<UserWithWalletResponse> {
    const user = await this.userModel.findById(userId).lean().exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const wallet = await this.walletModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .lean()
      .exec();
    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    return {
      user: {
        id: user._id.toString(),
        telegramId: user.telegramId,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      wallet: {
        id: wallet._id.toString(),
        userId: wallet.userId.toString(),
        balance: wallet.balance,
        lockedBalance: wallet.lockedBalance,
        freeBalance: wallet.balance - wallet.lockedBalance,
        createdAt: wallet.createdAt,
        updatedAt: wallet.updatedAt,
      },
    };
  }
}
