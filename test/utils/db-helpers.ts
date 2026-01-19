import { Model, Types, Connection } from 'mongoose';
import {
  User,
  UserDocument,
  Wallet,
  WalletDocument,
  Auction,
  AuctionDocument,
  AuctionStatus,
  Item,
  ItemDocument,
  Bid,
  BidDocument,
  BidStatus,
  Transaction,
  TransactionDocument,
} from 'src/models';

export interface CreateUserParams {
  telegramId?: number;
  hashedPassword?: string;
}

export interface CreateWalletParams {
  userId: Types.ObjectId;
  balance?: number;
  lockedBalance?: number;
}

export interface CreateItemParams {
  num?: number;
  collectionName?: string;
  value?: string;
  ownerId: Types.ObjectId;
}

export interface CreateAuctionParams {
  name?: string;
  status?: AuctionStatus;
  sellerId: Types.ObjectId;
  sellerWalletId: Types.ObjectId;
  settings?: {
    antisniping?: number;
    minBid?: number;
    minBidDifference?: number;
  };
  rounds?: Array<{
    startTime?: Date;
    endTime?: Date;
    status?: AuctionStatus;
    itemIds: Types.ObjectId[];
  }>;
}

export interface CreateBidParams {
  userId: Types.ObjectId;
  auctionId: Types.ObjectId;
  amount: number;
  status?: BidStatus;
}

/**
 * Database helpers for creating test documents
 */
export class DbHelpers {
  constructor(
    private userModel: Model<UserDocument>,
    private walletModel: Model<WalletDocument>,
    private auctionModel: Model<AuctionDocument>,
    private itemModel: Model<ItemDocument>,
    private bidModel: Model<BidDocument>,
    private transactionModel: Model<TransactionDocument>,
    private connection: Connection,
  ) {}

  /**
   * Creates a user document
   */
  async createUser(params: CreateUserParams = {}): Promise<UserDocument> {
    const telegramId =
      params.telegramId ?? Math.floor(Math.random() * 1000000000);
    return this.userModel.create({
      telegramId,
      hashedPassword: params.hashedPassword,
    });
  }

  /**
   * Creates a wallet document
   */
  async createWallet(params: CreateWalletParams): Promise<WalletDocument> {
    return this.walletModel.create({
      userId: params.userId,
      balance: params.balance ?? 0,
      lockedBalance: params.lockedBalance ?? 0,
    });
  }

  /**
   * Creates a user with an associated wallet
   */
  async createUserWithWallet(
    userParams: CreateUserParams = {},
    walletParams: Omit<CreateWalletParams, 'userId'> = {},
  ): Promise<{ user: UserDocument; wallet: WalletDocument }> {
    const user = await this.createUser(userParams);
    const wallet = await this.createWallet({
      userId: user._id,
      ...walletParams,
    });
    return { user, wallet };
  }

  /**
   * Creates an item document
   */
  async createItem(params: CreateItemParams): Promise<ItemDocument> {
    const num = params.num ?? Math.floor(Math.random() * 10000);
    const collectionName = params.collectionName ?? `collection_${Date.now()}`;
    return this.itemModel.create({
      num,
      collectionName,
      value: params.value ?? `value_${num}`,
      ownerId: params.ownerId,
    });
  }

  /**
   * Creates multiple items
   */
  async createItems(
    count: number,
    ownerId: Types.ObjectId,
    collectionName?: string,
  ): Promise<ItemDocument[]> {
    const items: ItemDocument[] = [];
    const baseCollectionName = collectionName ?? `collection_${Date.now()}`;

    for (let i = 0; i < count; i++) {
      const item = await this.createItem({
        num: i + 1,
        collectionName: baseCollectionName,
        value: `item_value_${i + 1}`,
        ownerId,
      });
      items.push(item);
    }

    return items;
  }

  /**
   * Creates an auction document
   */
  async createAuction(params: CreateAuctionParams): Promise<AuctionDocument> {
    const now = new Date();
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

    const defaultRounds = params.rounds ?? [
      {
        startTime: now,
        endTime: oneHourFromNow,
        status: AuctionStatus.ACTIVE,
        itemIds: [],
      },
    ];

    return this.auctionModel.create({
      name: params.name ?? `Test Auction ${Date.now()}`,
      status: params.status ?? AuctionStatus.ACTIVE,
      sellerId: params.sellerId,
      sellerWalletId: params.sellerWalletId,
      settings: {
        antisniping: params.settings?.antisniping ?? 60,
        minBid: params.settings?.minBid ?? 1,
        minBidDifference: params.settings?.minBidDifference ?? 1,
      },
      rounds: defaultRounds.map((round) => ({
        startTime: round.startTime ?? now,
        endTime: round.endTime ?? oneHourFromNow,
        status: round.status ?? AuctionStatus.ACTIVE,
        itemIds: round.itemIds,
      })),
    });
  }

  /**
   * Creates a complete auction with seller, items, and wallet
   */
  async createCompleteAuction(
    options: {
      itemCount?: number;
      sellerBalance?: number;
      auctionSettings?: CreateAuctionParams['settings'];
      roundEndTime?: Date;
    } = {},
  ): Promise<{
    seller: UserDocument;
    sellerWallet: WalletDocument;
    items: ItemDocument[];
    auction: AuctionDocument;
  }> {
    const { user: seller, wallet: sellerWallet } =
      await this.createUserWithWallet(
        {},
        { balance: options.sellerBalance ?? 0 },
      );

    const items = await this.createItems(options.itemCount ?? 3, seller._id);

    const now = new Date();
    const roundEndTime =
      options.roundEndTime ?? new Date(now.getTime() + 60 * 60 * 1000);

    const auction = await this.createAuction({
      sellerId: seller._id,
      sellerWalletId: sellerWallet._id,
      settings: options.auctionSettings ?? {
        antisniping: 60,
        minBid: 10,
        minBidDifference: 5,
      },
      rounds: [
        {
          startTime: now,
          endTime: roundEndTime,
          status: AuctionStatus.ACTIVE,
          itemIds: items.map((item) => item._id),
        },
      ],
    });

    return { seller, sellerWallet, items, auction };
  }

  /**
   * Creates a bid document
   */
  async createBid(params: CreateBidParams): Promise<BidDocument> {
    return this.bidModel.create({
      userId: params.userId,
      auctionId: params.auctionId,
      amount: params.amount,
      status: params.status ?? BidStatus.ACTIVE,
    });
  }

  /**
   * Gets auction by ID
   */
  async getAuction(
    auctionId: Types.ObjectId | string,
  ): Promise<AuctionDocument | null> {
    return this.auctionModel.findById(auctionId).exec();
  }

  /**
   * Gets wallet by user ID
   */
  async getWalletByUserId(
    userId: Types.ObjectId | string,
  ): Promise<WalletDocument | null> {
    return this.walletModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .exec();
  }

  /**
   * Gets all bids for an auction
   */
  async getBidsByAuction(
    auctionId: Types.ObjectId | string,
  ): Promise<BidDocument[]> {
    return this.bidModel
      .find({ auctionId: new Types.ObjectId(auctionId) })
      .exec();
  }

  /**
   * Gets all transactions
   */
  async getTransactions(): Promise<TransactionDocument[]> {
    return this.transactionModel.find().exec();
  }

  /**
   * Clears all data from the database
   */
  async clearDatabase(): Promise<void> {
    const collections = this.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany({});
    }
  }

  /**
   * Updates auction status
   */
  async updateAuctionStatus(
    auctionId: Types.ObjectId | string,
    status: AuctionStatus,
  ): Promise<void> {
    await this.auctionModel.updateOne(
      { _id: new Types.ObjectId(auctionId) },
      { $set: { status } },
    );
  }

  /**
   * Updates auction round end time (for testing antisniping and expiration)
   */
  async updateAuctionRoundEndTime(
    auctionId: Types.ObjectId | string,
    roundIndex: number,
    endTime: Date,
  ): Promise<void> {
    await this.auctionModel.updateOne(
      { _id: new Types.ObjectId(auctionId) },
      { $set: { [`rounds.${roundIndex}.endTime`]: endTime } },
    );
  }
}
