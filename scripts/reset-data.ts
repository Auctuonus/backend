import { connect, connection, model } from 'mongoose';
import { createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { AuctionSchema } from '../src/models/auction.schema';
import { ItemSchema } from '../src/models/item.schema';
import { UserSchema } from '../src/models/user.schema';
import { WalletSchema } from '../src/models/wallet.schema';
import { BidSchema } from '../src/models/bid.schema';
import { TransactionSchema } from '../src/models/transaction.schema';
import configuration from '../src/config';

const UserModel = model('User', UserSchema);
const WalletModel = model('Wallet', WalletSchema);
const ItemModel = model('Item', ItemSchema);
const AuctionModel = model('Auction', AuctionSchema);
const BidModel = model('Bid', BidSchema);
const TransactionModel = model('Transaction', TransactionSchema);

async function main() {
  const config = configuration();
  const rl = createInterface({ input, output });

  try {
    await connect(config.mongodbUrl);
    console.log(`✅ Connected to MongoDB: ${config.mongodbUrl}`);

    console.log('\n⚠️  WARNING: This will delete ALL data from the database!');
    console.log('   - Auctions');
    console.log('   - Items');
    console.log('   - Bids');
    console.log('   - Users');
    console.log('   - Wallets');
    console.log('   - Transactions');

    const confirm = (
      await rl.question('\nType "yes" to confirm deletion: ')
    ).trim();

    if (confirm.toLowerCase() !== 'yes') {
      console.log('❌ Aborted. No data was deleted.');
      return;
    }

    console.log('\n🗑️  Deleting data...');

    const auctionsResult = await AuctionModel.deleteMany({});
    console.log(`  ✅ Deleted ${auctionsResult.deletedCount} auctions`);

    const itemsResult = await ItemModel.deleteMany({});
    console.log(`  ✅ Deleted ${itemsResult.deletedCount} items`);

    const bidsResult = await BidModel.deleteMany({});
    console.log(`  ✅ Deleted ${bidsResult.deletedCount} bids`);

    const transactionsResult = await TransactionModel.deleteMany({});
    console.log(`  ✅ Deleted ${transactionsResult.deletedCount} transactions`);

    const walletsResult = await WalletModel.deleteMany({});
    console.log(`  ✅ Deleted ${walletsResult.deletedCount} wallets`);

    const usersResult = await UserModel.deleteMany({});
    console.log(`  ✅ Deleted ${usersResult.deletedCount} users`);

    console.log('\n🎉 All data has been reset successfully!');
  } catch (e) {
    console.error('❌ Error:', e);
    process.exitCode = 1;
  } finally {
    rl.close();
    await connection.close();
    console.log('🔌 MongoDB connection closed');
  }
}

main().catch((e) => {
  console.error('💥 Fatal:', e);
  process.exit(1);
});
