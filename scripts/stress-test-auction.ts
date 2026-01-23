import { connect, connection, model, Types } from 'mongoose';
import {
  connect as amqpConnect,
  Channel as AmqpChannel,
  ChannelModel as AmqpChannelModel,
} from 'amqplib';
import { randomUUID } from 'crypto';

import {
  AuctionRound,
  AuctionSchema,
  AuctionStatus,
} from '../src/models/auction.schema';
import { ItemSchema } from '../src/models/item.schema';
import { UserSchema } from '../src/models/user.schema';
import { WalletSchema } from '../src/models/wallet.schema';
import { BidSchema, BidStatus } from '../src/models/bid.schema';
import configuration from '../src/config';

const UserModel = model('User', UserSchema);
const WalletModel = model('Wallet', WalletSchema);
const ItemModel = model('Item', ItemSchema);
const AuctionModel = model('Auction', AuctionSchema);
const BidModel = model('Bid', BidSchema);

// Configuration for the stress test
const CONFIG = {
  auctionDurationMinutes: 2,
  usersCount: 10,
  bidsPerUser: 5,
  initialBalance: 100_000,
  minBid: 100,
  minBidDifference: 10,
  itemsCount: 3,
  antisniping: 30, // 30 seconds for quick test
};

async function createUsers(count: number, balance: number) {
  const users: { userId: Types.ObjectId; walletId: Types.ObjectId }[] = [];

  for (let i = 0; i < count; i++) {
    const telegramId = Math.floor(Math.random() * 1_000_000_000);
    const user = await UserModel.create({ telegramId });
    const wallet = await WalletModel.create({
      userId: user._id,
      balance,
      lockedBalance: 0,
    });
    users.push({ userId: user._id, walletId: wallet._id });
    console.log(
      `  👤 User ${i + 1}/${count}: ${String(user._id)} (tg=${telegramId})`,
    );
  }

  return users;
}

async function createItems(
  count: number,
  ownerId: Types.ObjectId,
): Promise<Types.ObjectId[]> {
  const itemIds: Types.ObjectId[] = [];

  for (let i = 0; i < count; i++) {
    const item = await ItemModel.create({
      num: Math.floor(Math.random() * 10000),
      collectionName: `StressTest_Collection_${Math.floor(Math.random() * 100)}`,
      value: `StressTest_Item_${i + 1}`,
      ownerId,
    });
    itemIds.push(item._id);
    console.log(`  📦 Item ${i + 1}/${count}: ${String(item._id)}`);
  }

  return itemIds;
}

async function createBids(
  users: { userId: Types.ObjectId; walletId: Types.ObjectId }[],
  auctionId: Types.ObjectId,
  bidsPerUser: number,
  minBid: number,
  minBidDifference: number,
) {
  let currentBid = minBid;
  const allBids: { odId: Types.ObjectId; amount: number; userId: Types.ObjectId }[] = [];

  // Generate bids in a realistic pattern - users outbid each other
  for (let round = 0; round < bidsPerUser; round++) {
    for (const user of users) {
      currentBid += minBidDifference + Math.floor(Math.random() * 50);
      const bid = await BidModel.create({
        userId: user.userId,
        auctionId,
        amount: currentBid,
        status: BidStatus.ACTIVE,
      });
      allBids.push({ odId: bid._id, amount: currentBid, userId: user.userId });
    }
  }

  console.log(
    `  💰 Created ${allBids.length} bids (final bid: ${currentBid})`,
  );
  return allBids;
}

async function main() {
  const config = configuration();
  let rabbitConnection: AmqpChannelModel | null = null;
  let rabbitChannel: AmqpChannel | null = null;

  console.log('🚀 Starting Stress Test Auction Script');
  console.log('=====================================');
  console.log(`  Duration: ${CONFIG.auctionDurationMinutes} minutes`);
  console.log(`  Users: ${CONFIG.usersCount}`);
  console.log(`  Bids per user: ${CONFIG.bidsPerUser}`);
  console.log(`  Items: ${CONFIG.itemsCount}`);
  console.log('=====================================\n');

  try {
    await connect(config.mongodbUrl);
    console.log(`✅ Connected to MongoDB: ${config.mongodbUrl}`);

    // Create seller
    console.log('\n📌 Creating seller...');
    const sellerTg = Math.floor(Math.random() * 1_000_000_000);
    const seller = await UserModel.create({ telegramId: sellerTg });
    const sellerWallet = await WalletModel.create({
      userId: seller._id,
      balance: CONFIG.initialBalance,
      lockedBalance: 0,
    });
    console.log(
      `  👤 Seller: ${String(seller._id)} (tg=${sellerTg})`,
    );

    // Create bidders
    console.log('\n📌 Creating bidders...');
    const bidders = await createUsers(CONFIG.usersCount, CONFIG.initialBalance);

    // Create items
    console.log('\n📌 Creating items...');
    const itemIds = await createItems(CONFIG.itemsCount, seller._id);

    // Create auction with short duration
    console.log('\n📌 Creating auction...');
    const now = new Date();
    const startTime = new Date(now.getTime() + 5 * 1000); // Start in 5 seconds
    const endTime = new Date(
      startTime.getTime() + CONFIG.auctionDurationMinutes * 60 * 1000,
    );

    const rounds: AuctionRound[] = [
      {
        startTime,
        endTime,
        itemIds,
        status: AuctionStatus.ACTIVE,
      },
    ];

    const auction = await AuctionModel.create({
      name: `Stress Test Auction ${Date.now()}`,
      status: AuctionStatus.ACTIVE,
      sellerId: seller._id,
      sellerWalletId: sellerWallet._id,
      settings: {
        antisniping: CONFIG.antisniping,
        minBid: CONFIG.minBid,
        minBidDifference: CONFIG.minBidDifference,
      },
      rounds,
    });

    console.log(`  🎯 Auction ID: ${String(auction._id)}`);
    console.log(`  📅 Start: ${startTime.toISOString()}`);
    console.log(`  📅 End: ${endTime.toISOString()}`);

    // Create bids
    console.log('\n📌 Creating bids...');
    await createBids(
      bidders,
      auction._id,
      CONFIG.bidsPerUser,
      CONFIG.minBid,
      CONFIG.minBidDifference,
    );

    // Push to RabbitMQ
    console.log('\n📌 Publishing to RabbitMQ...');
    try {
      rabbitConnection = await amqpConnect(config.rabbitmq.uri as string);
      rabbitChannel = await rabbitConnection.createChannel();

      await rabbitChannel.assertExchange('delayed.ex', 'x-delayed-message', {
        durable: true,
        arguments: {
          'x-delayed-type': 'direct',
        },
      });

      await rabbitChannel.assertQueue('jobs.q', { durable: true });
      await rabbitChannel.bindQueue('jobs.q', 'delayed.ex', 'jobs');

      const delay = Math.max(0, endTime.getTime() - Date.now());

      const jobMessage = {
        id: randomUUID(),
        auctionId: String(auction._id),
        publishedAt: new Date().toISOString(),
      };

      rabbitChannel.publish(
        'delayed.ex',
        'jobs',
        Buffer.from(JSON.stringify(jobMessage)),
        {
          persistent: true,
          headers: {
            'x-delay': delay,
          },
        },
      );

      console.log(`  ✅ Published job to RabbitMQ`);
      console.log(`  📨 Job ID: ${jobMessage.id}`);
      console.log(`  ⏱️  Delay: ${Math.round(delay / 1000)}s`);
    } catch (rabbitError) {
      console.error('  ❌ RabbitMQ Error:', rabbitError);
    }

    // Summary
    console.log('\n=====================================');
    console.log('📋 SUMMARY');
    console.log('=====================================');
    console.log(`  Auction ID: ${String(auction._id)}`);
    console.log(`  Seller ID: ${String(seller._id)}`);
    console.log(`  Users created: ${CONFIG.usersCount}`);
    console.log(`  Total bids: ${CONFIG.usersCount * CONFIG.bidsPerUser}`);
    console.log(`  Items: ${CONFIG.itemsCount}`);
    console.log(`  Start: ${startTime.toLocaleString()}`);
    console.log(`  End: ${endTime.toLocaleString()}`);
    console.log('=====================================');
    console.log('\n🎉 Stress test auction created successfully!');
  } catch (e) {
    console.error('❌ Error:', e);
    process.exitCode = 1;
  } finally {
    if (rabbitChannel) {
      await rabbitChannel.close();
      console.log('🔌 RabbitMQ channel closed');
    }
    if (rabbitConnection) {
      await rabbitConnection.close();
      console.log('🔌 RabbitMQ connection closed');
    }
    await connection.close();
    console.log('🔌 MongoDB connection closed');
  }
}

main().catch((e) => {
  console.error('💥 Fatal:', e);
  process.exit(1);
});
