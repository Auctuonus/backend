/**
 * Script to create test data for manual testing
 * 
 * Usage: npx ts-node scripts/setup-test-data.ts
 * 
 * Creates:
 * - Test users with wallets
 * - Test auction with items
 * 
 * After running, use the printed credentials to test via API/Swagger
 */

import { MongoClient, ObjectId } from 'mongodb';
import * as bcrypt from 'bcrypt';

const MONGODB_URL = process.env.MONGODB_URL || 'mongodb://localhost:27017/auctionus';

async function main() {
  console.log('=== Setting up test data ===\n');
  console.log(`MongoDB URL: ${MONGODB_URL}\n`);

  const client = new MongoClient(MONGODB_URL);
  
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB\n');

    const db = client.db();
    
    // Create test users
    console.log('Creating test users...');
    const hashedPassword = await bcrypt.hash('test-password', 10);
    
    const users = [];
    for (let i = 1; i <= 5; i++) {
      const telegramId = 100000000 + i;
      
      // Check if user exists
      let user = await db.collection('users').findOne({ telegramId });
      
      if (!user) {
        const result = await db.collection('users').insertOne({
          telegramId,
          hashedPassword,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        user = { _id: result.insertedId, telegramId };
        
        // Create wallet
        await db.collection('wallets').insertOne({
          userId: result.insertedId,
          balance: 10000,
          lockedBalance: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        console.log(`   ✅ Created user ${i}: telegramId=${telegramId}`);
      } else {
        // Update password if user exists
        await db.collection('users').updateOne(
          { _id: user._id },
          { $set: { hashedPassword } }
        );
        // Ensure wallet exists and has balance
        await db.collection('wallets').updateOne(
          { userId: user._id },
          { 
            $set: { balance: 10000, lockedBalance: 0 },
            $setOnInsert: { createdAt: new Date() }
          },
          { upsert: true }
        );
        console.log(`   ✅ Updated user ${i}: telegramId=${telegramId}`);
      }
      users.push(user);
    }

    // Create seller user
    const sellerTelegramId = 999999999;
    let seller = await db.collection('users').findOne({ telegramId: sellerTelegramId });
    
    if (!seller) {
      const result = await db.collection('users').insertOne({
        telegramId: sellerTelegramId,
        hashedPassword,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      seller = { _id: result.insertedId, telegramId: sellerTelegramId };
      
      await db.collection('wallets').insertOne({
        userId: result.insertedId,
        balance: 0,
        lockedBalance: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      console.log(`   ✅ Created seller: telegramId=${sellerTelegramId}`);
    } else {
      console.log(`   ✅ Seller exists: telegramId=${sellerTelegramId}`);
    }

    const sellerWallet = await db.collection('wallets').findOne({ userId: seller._id });

    // Create items
    console.log('\nCreating test items...');
    const items = [];
    for (let i = 1; i <= 3; i++) {
      const item = await db.collection('items').insertOne({
        num: `${i}`,
        collectionName: 'test-collection',
        value: `Test Item #${i}`,
        ownerId: seller._id,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      items.push(item.insertedId);
      console.log(`   ✅ Created item ${i}`);
    }

    // Create auction
    console.log('\nCreating test auction...');
    const now = new Date();
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

    // Delete old test auctions
    await db.collection('auctions').deleteMany({ name: 'Test Auction for Lock Testing' });

    const auctionResult = await db.collection('auctions').insertOne({
      name: 'Test Auction for Lock Testing',
      status: 'active',
      sellerId: seller._id,
      sellerWalletId: sellerWallet!._id,
      settings: {
        antisniping: 60,
        minBid: 10,
        minBidDifference: 5,
      },
      rounds: [{
        startTime: now,
        endTime: oneHourFromNow,
        status: 'active',
        itemIds: items,
      }],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    console.log(`   ✅ Created auction: ${auctionResult.insertedId}`);

    // Clear old bids for this auction
    await db.collection('bids').deleteMany({ auctionId: auctionResult.insertedId });

    // Print summary
    console.log('\n========================================');
    console.log('TEST DATA CREATED SUCCESSFULLY');
    console.log('========================================\n');
    
    console.log('Test Users (password: "test-password"):');
    for (let i = 1; i <= 5; i++) {
      console.log(`  User ${i}: telegramId = ${100000000 + i}`);
    }
    console.log(`  Seller: telegramId = ${sellerTelegramId}`);
    
    console.log(`\nTest Auction ID: ${auctionResult.insertedId}`);
    console.log('\n========================================');
    console.log('HOW TO TEST:');
    console.log('========================================\n');
    
    console.log('1. Open Swagger UI: http://localhost:3000/api\n');
    
    console.log('2. Login via POST /auth/password:');
    console.log('   { "telegramId": 100000001, "password": "test-password" }\n');
    
    console.log('3. Copy accessToken and click "Authorize" button\n');
    
    console.log('4. Place bid via POST /bids/set_bid:');
    console.log(`   { "auctionId": "${auctionResult.insertedId}", "amount": 100 }\n`);
    
    console.log('5. Check backend logs for lock messages:\n');
    console.log('   "Lock acquired: lock:auction:..."');
    console.log('   "Lock released: lock:auction:..."\n');

    console.log('Or run the test script:');
    console.log(`   AUCTION_ID=${auctionResult.insertedId} npx ts-node scripts/test-locks.ts\n`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
  }
}

main();
