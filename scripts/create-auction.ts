import { connect, connection, model, Types } from 'mongoose';
import { createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'node:process';
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
import configuration from '../src/config';

const UserModel = model('User', UserSchema);
const WalletModel = model('Wallet', WalletSchema);
const ItemModel = model('Item', ItemSchema);
const AuctionModel = model('Auction', AuctionSchema);

function parseIntOr<T extends number | null>(
  value: string,
  def: T,
): number | T {
  const v = parseInt(value, 10);
  return Number.isFinite(v) ? v : def;
}

async function ensureSeller(rl: ReturnType<typeof createInterface>) {
  const sellerInput = (
    await rl.question(
      'Seller (Mongo ObjectId or "tg:<number>", empty = create new): ',
    )
  ).trim();

  if (sellerInput) {
    if (sellerInput.startsWith('tg:')) {
      const tg = parseInt(sellerInput.slice(3), 10);
      const existing = await UserModel.findOne({ telegramId: tg });
      if (!existing) throw new Error(`User with telegramId=${tg} not found`);
      const wallet = await WalletModel.findOne({ userId: existing._id });
      if (!wallet)
        throw new Error(`Wallet for user ${String(existing._id)} not found`);
      return {
        userId: existing._id,
        walletId: wallet._id,
      };
    }
    const id = new Types.ObjectId(sellerInput);
    const existing = await UserModel.findById(id);
    if (!existing) throw new Error(`User ${sellerInput} not found`);
    const wallet = await WalletModel.findOne({ userId: existing._id });
    if (!wallet)
      throw new Error(`Wallet for user ${String(existing._id)} not found`);
    return {
      userId: existing._id,
      walletId: wallet._id,
    };
  }

  // Create new user + wallet
  const randomTg = Math.floor(Math.random() * 1_000_000_000);
  const user = await UserModel.create({ telegramId: randomTg });
  const balStr = (
    await rl.question('Initial wallet balance (empty = 10000): ')
  ).trim();
  const balance = balStr ? parseInt(balStr, 10) : 10_000;
  const wallet = await WalletModel.create({
    userId: user._id,
    balance,
    lockedBalance: 0,
  });
  console.log(
    `👤 Created seller ${String(user._id)} (tg=${randomTg}) with wallet ${String(wallet._id)} (balance=${balance})`,
  );
  return {
    userId: user._id,
    walletId: wallet._id,
  };
}

async function main() {
  const config = configuration();
  const rl = createInterface({ input, output });
  let rabbitConnection: AmqpChannelModel | null = null;
  let rabbitChannel: AmqpChannel | null = null;

  try {
    await connect(config.mongodbUrl);
    console.log(`✅ Connected to MongoDB: ${config.mongodbUrl}`);

    // Seller
    const { userId, walletId } = await ensureSeller(rl);

    // Auction fields
    const name =
      (await rl.question('Auction name (empty = Fake Auction): ')).trim() ||
      `Fake Auction ${Date.now()}`;
    const roundsStr = (await rl.question('Rounds count (empty = 3): ')).trim();
    const roundsCount = parseIntOr(roundsStr, 3);

    const antiStr = (
      await rl.question(
        'Antisniping seconds (empty = 600, "0"/"off" = disable): ',
      )
    ).trim();
    const antisniping =
      antiStr === '0' || antiStr.toLowerCase() === 'off'
        ? 0
        : antiStr
          ? parseInt(antiStr, 10)
          : 600;

    const minBidStr = (await rl.question('Min bid (empty = 100): ')).trim();
    const minBid = parseIntOr(minBidStr, 100);
    const minDiffStr = (
      await rl.question('Min bid difference (empty = 10): ')
    ).trim();
    const minBidDifference = parseIntOr(minDiffStr, 10);

    const itemsStr = (
      await rl.question('Total items to create (empty = 3): ')
    ).trim();
    const totalItems = parseIntOr(itemsStr, 3);

    // Create items
    const items: { _id: Types.ObjectId }[] = [];
    for (let i = 0; i < totalItems; i++) {
      const item = await ItemModel.create({
        num: Math.floor(Math.random() * 10000),
        collectionName: `Collection_${Math.floor(Math.random() * 100)}`,
        value: `Item_Value_${i + 1}`,
        ownerId: userId,
      });
      items.push(item);
      console.log(
        `  ✅ Created item ${i + 1}/${totalItems}: ${String(item._id)}`,
      );
    }

    // Distribute items across rounds
    const perRound: Types.ObjectId[][] = [];
    for (let r = 0; r < roundsCount; r++) perRound[r] = [];
    for (let i = 0; i < items.length; i++) {
      perRound[i % roundsCount].push(items[i]._id);
    }

    // Compute times
    const now = new Date();
    const rounds: AuctionRound[] = [];
    for (let r = 0; r < roundsCount; r++) {
      const start = new Date(
        now.getTime() + (r === 0 ? 5 : 65 + (r - 1) * 70) * 60 * 1000,
      ); // spaced with 5 min lead, then offsets
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      rounds.push({
        startTime: start,
        endTime: end,
        itemIds: perRound[r],
        status: AuctionStatus.ACTIVE,
      });
    }

    const auction = await AuctionModel.create({
      name,
      status: AuctionStatus.ACTIVE,
      sellerId: userId,
      sellerWalletId: walletId,
      settings: { antisniping, minBid, minBidDifference },
      rounds,
    });

    console.log('\n📋 Auction summary:');
    console.log(`  ID: ${String(auction._id)}`);
    console.log(`  Name: ${auction.name}`);
    console.log(`  Rounds: ${auction.rounds.length}`);
    console.log(
      `  Antisniping: ${antisniping === null ? 'off' : antisniping + 's'}`,
    );

    // Ask if user wants to push message to RabbitMQ
    const pushToRabbit = (
      await rl.question(
        '\nPush auction to RabbitMQ for processing? (y/n, empty = y): ',
      )
    ).trim();

    if (pushToRabbit === '' || pushToRabbit.toLowerCase() === 'y') {
      try {
        console.log(`\n🐰 Connecting to RabbitMQ: ${config.rabbitmq.uri}`);
        rabbitConnection = await amqpConnect(config.rabbitmq.uri as string);
        rabbitChannel = await rabbitConnection.createChannel();

        // Declare exchange with delay plugin
        await rabbitChannel.assertExchange('delayed.ex', 'x-delayed-message', {
          durable: true,
          arguments: {
            'x-delayed-type': 'direct',
          },
        });

        // Declare queue
        await rabbitChannel.assertQueue('jobs.q', { durable: true });
        await rabbitChannel.bindQueue('jobs.q', 'delayed.ex', 'jobs');

        // Ask when to process (default: first round end time)
        const firstRoundEnd = auction.rounds[0].endTime;
        console.log(
          `\n  First round ends at: ${firstRoundEnd.toISOString()} (${firstRoundEnd.toLocaleString()})`,
        );

        const processTimeStr = (
          await rl.question(
            'When to process? (ISO date or "now" or empty = first round end): ',
          )
        ).trim();

        let processAt: Date;
        if (processTimeStr === 'now') {
          processAt = new Date();
        } else if (processTimeStr === '') {
          processAt = firstRoundEnd;
        } else {
          processAt = new Date(processTimeStr);
        }

        // Calculate delay from now
        const now = new Date();
        const delay = Math.max(0, processAt.getTime() - now.getTime());

        // Create job message
        const jobMessage = {
          id: randomUUID(),
          auctionId: String(auction._id),
          publishedAt: new Date().toISOString(),
        };

        // Publish message
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

        console.log(`✅ Published message to RabbitMQ:`);
        console.log(`   Job ID: ${jobMessage.id}`);
        console.log(
          `   Process at: ${processAt.toISOString()} (${processAt.toLocaleString()})`,
        );
        console.log(`   Delay: ${delay}ms (${Math.round(delay / 1000)}s)`);
      } catch (rabbitError) {
        console.error('❌ RabbitMQ Error:', rabbitError);
      }
    }

    console.log('\n🎉 Done');
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
