import { connect, connection, model } from 'mongoose';
import { createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { UserSchema } from '../src/models/user.schema';
import { WalletSchema } from '../src/models/wallet.schema';
import configuration from '../src/config';

const UserModel = model('User', UserSchema);
const WalletModel = model('Wallet', WalletSchema);

async function main() {
  const config = configuration();
  const rl = createInterface({ input, output });

  try {
    await connect(config.mongodbUrl);
    console.log(`✅ Connected to MongoDB: ${config.mongodbUrl}`);

    const tgStr = (
      await rl.question('Telegram User ID: ')
    ).trim();

    if (!tgStr) {
      console.log('❌ Telegram ID is required');
      return;
    }

    const telegramId = parseInt(tgStr, 10);
    const user = await UserModel.findOne({ telegramId });

    if (!user) {
      console.log(`❌ User with telegramId=${telegramId} not found`);
      return;
    }

    console.log(`👤 Found user: ${String(user._id)}`);

    const wallet = await WalletModel.findOne({ userId: user._id });

    if (!wallet) {
      console.log(`❌ Wallet for user ${String(user._id)} not found`);
      return;
    }

    console.log(`💰 Current balance: ${wallet.balance}, locked: ${wallet.lockedBalance}`);

    const amountStr = (
      await rl.question('Amount to add (empty = 10000): ')
    ).trim();
    const amount = amountStr ? parseInt(amountStr, 10) : 10_000;

    if (amount <= 0) {
      console.log('❌ Amount must be positive');
      return;
    }

    wallet.balance += amount;
    await wallet.save();

    console.log(`\n✅ Added ${amount} to wallet`);
    console.log(`💰 New balance: ${wallet.balance}, locked: ${wallet.lockedBalance}`);
    console.log(`💵 Free balance: ${wallet.balance - wallet.lockedBalance}`);

    console.log('\n🎉 Done');
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
