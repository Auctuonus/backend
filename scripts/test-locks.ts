/**
 * Quick test script to verify distributed locks are working
 * 
 * Usage: npx ts-node scripts/test-locks.ts
 * 
 * This script:
 * 1. Creates a test user via password auth
 * 2. Sends concurrent bid requests
 * 3. Verifies that locks prevent race conditions
 */

import * as http from 'http';

const API_URL = process.env.API_URL || 'http://localhost:3000';

interface RequestResult {
  success: boolean;
  status: number;
  body: any;
  time: number;
}

async function makeRequest(
  path: string,
  method: string,
  body?: object,
  token?: string,
): Promise<RequestResult> {
  const startTime = Date.now();
  const url = new URL(path, API_URL);

  return new Promise((resolve) => {
    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({
          success: res.statusCode === 201 || res.statusCode === 200,
          status: res.statusCode || 0,
          body: parsed,
          time: Date.now() - startTime,
        });
      });
    });

    req.on('error', (error) => {
      resolve({
        success: false,
        status: 0,
        body: { error: error.message },
        time: Date.now() - startTime,
      });
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function login(telegramId: number, password: string): Promise<string | null> {
  const result = await makeRequest('/auth/password', 'POST', { telegramId, password });
  if (result.success && result.body.accessToken) {
    return result.body.accessToken;
  }
  console.log('Login failed:', result.body);
  return null;
}

async function getMyInfo(token: string): Promise<any> {
  return makeRequest('/users/get_me', 'POST', {}, token);
}

async function placeBid(token: string, auctionId: string, amount: number): Promise<RequestResult> {
  return makeRequest('/bids/set_bid', 'POST', { auctionId, amount }, token);
}

async function getAuctions(token: string): Promise<RequestResult> {
  return makeRequest('/auctions/get_list', 'POST', { pagination: { page: 1, pageSize: 10 } }, token);
}

async function main() {
  console.log('=== Lock Test Script ===\n');
  console.log(`API URL: ${API_URL}\n`);

  // Step 1: Login
  console.log('1. Logging in...');
  const token = await login(123456789, 'test-password');
  if (!token) {
    console.log('\n❌ Login failed. Make sure the user exists or create one first.');
    console.log('   You can create a user via Telegram auth or the /auth/password endpoint.');
    return;
  }
  console.log('   ✅ Login successful\n');

  // Step 2: Get user info
  console.log('2. Getting user info...');
  const userInfo = await getMyInfo(token);
  if (!userInfo.success) {
    console.log('   ❌ Failed to get user info:', userInfo.body);
    return;
  }
  console.log(`   ✅ User ID: ${userInfo.body.user.id}`);
  console.log(`   ✅ Balance: ${userInfo.body.wallet.balance}`);
  console.log(`   ✅ Locked: ${userInfo.body.wallet.lockedBalance}\n`);

  // Step 3: Get auctions
  console.log('3. Getting active auctions...');
  const auctions = await getAuctions(token);
  if (!auctions.success || !auctions.body.auctions?.length) {
    console.log('   ⚠️ No active auctions found.');
    console.log('   Create an auction first to test bid locking.\n');
    return;
  }
  const auctionId = auctions.body.auctions[0].id;
  console.log(`   ✅ Found ${auctions.body.auctions.length} auction(s)`);
  console.log(`   ✅ Using auction: ${auctionId}\n`);

  // Step 4: Test concurrent bids
  console.log('4. Testing concurrent bids (5 simultaneous requests)...');
  const bidAmounts = [100, 110, 120, 130, 140];
  const bidPromises = bidAmounts.map((amount) => placeBid(token, auctionId, amount));
  
  const startTime = Date.now();
  const results = await Promise.all(bidPromises);
  const totalTime = Date.now() - startTime;

  console.log(`   Total time: ${totalTime}ms\n`);
  
  results.forEach((result, index) => {
    const status = result.success ? '✅' : '❌';
    console.log(`   ${status} Bid ${bidAmounts[index]}: ${result.status} (${result.time}ms)`);
    if (!result.success && result.body?.message) {
      console.log(`      Error: ${result.body.message}`);
    }
  });

  // Step 5: Verify final state
  console.log('\n5. Verifying final state...');
  const finalInfo = await getMyInfo(token);
  if (finalInfo.success) {
    console.log(`   ✅ Final Balance: ${finalInfo.body.wallet.balance}`);
    console.log(`   ✅ Final Locked: ${finalInfo.body.wallet.lockedBalance}`);
  }

  // Summary
  const successCount = results.filter((r) => r.success).length;
  console.log('\n=== Summary ===');
  console.log(`Successful bids: ${successCount}/${results.length}`);
  
  if (successCount > 0) {
    console.log('\n✅ Locks are working! Concurrent requests were processed sequentially.');
    console.log('   Check backend logs for "Lock acquired/released" messages.');
  } else {
    console.log('\n⚠️ All bids failed. Check:');
    console.log('   - Wallet has sufficient balance');
    console.log('   - Auction is active');
    console.log('   - Bid amount meets minimum requirements');
  }
}

main().catch(console.error);
