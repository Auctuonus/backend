import { connect, connection, model } from 'mongoose';
import { createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import bcrypt from 'bcrypt';

import { UserSchema } from '../src/models/user.schema';
import { WalletSchema } from '../src/models/wallet.schema';

const UserModel = model('User', UserSchema);
const WalletModel = model('Wallet', WalletSchema);

async function main() {
  const mongoUrl = process.env.MONGODB_URL || 'mongodb://mongodb:27017/auctionus';
  const rl = createInterface({ input, output });

  try {
    await connect(mongoUrl);
    console.log(`✅ Connected to MongoDB: ${mongoUrl}`);

    const tgStr = (await rl.question('Telegram User ID (empty = random): ')).trim();
    const telegramId = tgStr ? parseInt(tgStr, 10) : Math.floor(Math.random() * 1_000_000_000);

    const balanceStr = (await rl.question('Initial wallet balance (empty = 10000): ')).trim();
    const balance = balanceStr ? parseInt(balanceStr, 10) : 10_000;

    const pwd = (await rl.question("Password (empty = default '123456'): ")).trim();

    let user = await UserModel.findOne({ telegramId });
    if (user) {
      console.log(`ℹ️  User with telegramId=${telegramId} already exists: ${String(user._id)}`);
    } else {
      const passwordToHash = pwd || '123456';
      const hashedPassword = await bcrypt.hash(passwordToHash, 10);
      user = await UserModel.create({ telegramId, hashedPassword });
      console.log(`👤 Created user: ${String(user._id)} (tg=${telegramId})`);
    }

    let wallet = await WalletModel.findOne({ userId: user._id });
    if (wallet) {
      console.log(`ℹ️  Wallet already exists: ${String(wallet._id)} (balance=${wallet.balance})`);
    } else {
      wallet = await WalletModel.create({ userId: user._id, balance, lockedBalance: 0 });
      console.log(`💰 Created wallet: ${String(wallet._id)} (balance=${wallet.balance})`);
    }

    console.log('\n📋 Summary:');
    console.log(`  User ID: ${String(user._id)}  | telegramId: ${telegramId}`);
    console.log(`  Wallet ID: ${String(wallet._id)} | balance: ${wallet.balance}, locked: ${wallet.lockedBalance}`);
    console.log('\n🎉 Done');
  } catch (e) {
    console.error('❌ Error:', e);
    process.exitCode = 1;
  } finally {
    await connection.close();
    await rl.close();
  }
}

main().catch((e) => {
  console.error('💥 Fatal:', e);
  process.exit(1);
});
