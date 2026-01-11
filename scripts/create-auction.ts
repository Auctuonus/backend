import { connect, connection } from 'mongoose';
import { model } from 'mongoose';

// Import existing schemas
import { AuctionSchema, AuctionStatus } from '../src/models/auction.schema';
import { ItemSchema } from '../src/models/item.schema';
import { UserSchema } from '../src/models/user.schema';
import { WalletSchema } from '../src/models/wallet.schema';

// Create models using existing schemas
const UserModel = model('User', UserSchema);
const WalletModel = model('Wallet', WalletSchema);
const ItemModel = model('Item', ItemSchema);
const AuctionModel = model('Auction', AuctionSchema);

async function createFakeAuction() {
  const mongoUrl =
    process.env.MONGODB_URL || 'mongodb://mongodb:27017/auctionus';

  console.log('🔌 Connecting to MongoDB:', mongoUrl);

  try {
    await connect(mongoUrl);
    console.log('✅ Connected to MongoDB');

    // Create a fake user (seller)
    console.log('👤 Creating fake seller...');
    const fakeUser = await UserModel.create({
      telegramId: Math.floor(Math.random() * 1000000000),
    });
    console.log(`✅ Created user with ID: ${String(fakeUser._id)}`);

    // Create a wallet for the seller
    console.log('💰 Creating seller wallet...');
    const sellerWallet = await WalletModel.create({
      userId: fakeUser._id,
      balance: 10000,
      lockedBalance: 0,
    });
    console.log(`✅ Created wallet with ID: ${String(sellerWallet._id)}`);

    // Create fake items for the auction
    console.log('🎨 Creating fake items...');
    const itemsCount = 3;
    const items = [];

    for (let i = 0; i < itemsCount; i++) {
      const item = await ItemModel.create({
        num: Math.floor(Math.random() * 10000),
        collectionName: `Collection_${Math.floor(Math.random() * 100)}`,
        value: `Item_Value_${i + 1}`,
        ownerId: fakeUser._id,
      });
      items.push(item);
      console.log(
        `  ✅ Created item ${i + 1}/${itemsCount}: ${String(item._id)}`,
      );
    }

    // Create auction with multiple rounds
    console.log('🏛️ Creating auction...');
    const now = new Date();
    const round1Start = new Date(now.getTime() + 1000 * 60 * 5); // Start in 5 minutes
    const round1End = new Date(round1Start.getTime() + 1000 * 60 * 60); // 1 hour duration
    const round2Start = new Date(round1End.getTime() + 1000 * 60 * 10); // 10 min break
    const round2End = new Date(round2Start.getTime() + 1000 * 60 * 60); // 1 hour duration

    const auction = await AuctionModel.create({
      name: `Fake Auction ${Date.now()}`,
      status: AuctionStatus.ACTIVE,
      sellerId: fakeUser._id,
      sellerWalletId: sellerWallet._id,
      settings: {
        antisniping: 300, // 5 minutes in seconds
        minBid: 100,
        minBidDifference: 10,
      },
      rounds: [
        {
          startTime: round1Start,
          endTime: round1End,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
          itemIds: [items[0]._id],
        },
        {
          startTime: round2Start,
          endTime: round2End,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
          itemIds: items.slice(1).map((item) => item._id),
        },
      ],
    });

    console.log('✅ Created auction successfully!');
    console.log('\n📋 Auction Details:');
    console.log(`  ID: ${String(auction._id)}`);
    console.log(`  Name: ${auction.name}`);
    console.log(`  Status: ${auction.status}`);
    console.log(`  Seller ID: ${String(auction.sellerId)}`);
    console.log(`  Items count: ${items.length}`);
    console.log(`  Rounds count: ${auction.rounds.length}`);
    console.log(
      `  Round 1: ${round1Start.toISOString()} - ${round1End.toISOString()}`,
    );
    console.log(
      `  Round 2: ${round2Start.toISOString()} - ${round2End.toISOString()}`,
    );
    console.log('\n🎉 Script completed successfully!\n');
  } catch (error) {
    console.error('❌ Error creating fake auction:', error);
    throw error;
  } finally {
    await connection.close();
    console.log('🔌 MongoDB connection closed');
  }
}

// Run the script
createFakeAuction()
  .then(() => {
    console.log('✨ Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  });
