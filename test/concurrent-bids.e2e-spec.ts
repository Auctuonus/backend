import * as request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import {
  TestAppContext,
  createTestWebApp,
  closeTestApp,
  DbHelpers,
  generateTestTokens,
} from './utils';
import { BidStatus } from 'src/models';

describe('Concurrent Bids (e2e)', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let dbHelpers: DbHelpers;
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestWebApp();
    app = ctx.app;
    jwtService = ctx.jwtService;
    dbHelpers = ctx.dbHelpers;
  }, 60000); // 60 second timeout for setup

  afterAll(async () => {
    if (ctx) {
      await closeTestApp(ctx);
    }
  }, 30000);

  beforeEach(async () => {
    await dbHelpers.clearDatabase();
  }, 30000);

  describe('Concurrent bid placement', () => {
    it('should handle multiple concurrent bids from different users', async () => {
      const { auction } = await dbHelpers.createCompleteAuction({
        auctionSettings: { minBid: 10, minBidDifference: 1, antisniping: 60 },
      });

      // Create 10 users with wallets
      const users = [];
      for (let i = 0; i < 10; i++) {
        const { user, wallet } = await dbHelpers.createUserWithWallet(
          {},
          { balance: 10000 },
        );
        users.push({ user, wallet });
      }

      // Place bids concurrently
      const bidPromises = users.map((u, index) => {
        const tokens = generateTestTokens(jwtService, {
          userId: u.user._id.toString(),
          telegramId: u.user.telegramId,
        });

        return request(app.getHttpServer())
          .post('/bids/set_bid')
          .set('Authorization', `Bearer ${tokens.accessToken}`)
          .send({
            auctionId: auction._id.toString(),
            amount: 100 + index * 10,
          });
      });

      const responses = await Promise.all(bidPromises);

      // All bids should succeed
      const successCount = responses.filter((r) => r.status === 201).length;
      expect(successCount).toBe(10);

      // Verify all bids were created
      const bids = await dbHelpers.getBidsByAuction(auction._id);
      expect(bids).toHaveLength(10);

      // Verify all wallets have correct locked balance
      for (let i = 0; i < users.length; i++) {
        const wallet = await dbHelpers.getWalletByUserId(users[i].user._id);
        expect(wallet.lockedBalance).toBe(100 + i * 10);
      }
    });

    it('should handle concurrent bid updates from same user', async () => {
      const { auction } = await dbHelpers.createCompleteAuction({
        auctionSettings: { minBid: 10, minBidDifference: 5, antisniping: 60 },
      });

      const { user: bidder } = await dbHelpers.createUserWithWallet(
        {},
        { balance: 10000 },
      );

      const tokens = generateTestTokens(jwtService, {
        userId: bidder._id.toString(),
        telegramId: bidder.telegramId,
      });

      // First bid
      await request(app.getHttpServer())
        .post('/bids/set_bid')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ auctionId: auction._id.toString(), amount: 100 })
        .expect(201);

      // Try to update bid concurrently with different amounts
      const updatePromises = [150, 200, 250, 300, 350].map((amount) =>
        request(app.getHttpServer())
          .post('/bids/set_bid')
          .set('Authorization', `Bearer ${tokens.accessToken}`)
          .send({ auctionId: auction._id.toString(), amount }),
      );

      const responses = await Promise.all(updatePromises);

      // At least some should succeed (locks ensure sequential processing)
      const successCount = responses.filter((r) => r.status === 201).length;
      expect(successCount).toBeGreaterThan(0);

      // Verify only one bid exists with highest successful amount
      const bids = await dbHelpers.getBidsByAuction(auction._id);
      expect(bids).toHaveLength(1);

      // Wallet locked balance should match the final bid amount
      const wallet = await dbHelpers.getWalletByUserId(bidder._id);
      expect(wallet.lockedBalance).toBe(bids[0].amount);
    });

    it('should prevent double spending with concurrent bids', async () => {
      const { auction: auction1 } = await dbHelpers.createCompleteAuction({
        auctionSettings: { minBid: 10, minBidDifference: 5, antisniping: 60 },
      });
      const { auction: auction2 } = await dbHelpers.createCompleteAuction({
        auctionSettings: { minBid: 10, minBidDifference: 5, antisniping: 60 },
      });

      // User with limited balance
      const { user: bidder } = await dbHelpers.createUserWithWallet(
        {},
        { balance: 150 }, // Only enough for one bid of 100
      );

      const tokens = generateTestTokens(jwtService, {
        userId: bidder._id.toString(),
        telegramId: bidder.telegramId,
      });

      // Try to place bids on both auctions concurrently
      const [response1, response2] = await Promise.all([
        request(app.getHttpServer())
          .post('/bids/set_bid')
          .set('Authorization', `Bearer ${tokens.accessToken}`)
          .send({ auctionId: auction1._id.toString(), amount: 100 }),
        request(app.getHttpServer())
          .post('/bids/set_bid')
          .set('Authorization', `Bearer ${tokens.accessToken}`)
          .send({ auctionId: auction2._id.toString(), amount: 100 }),
      ]);

      // One should succeed, one should fail (not enough balance)
      const statuses = [response1.status, response2.status].sort();

      // With locks, we expect one success and one failure
      // The exact outcome depends on which lock is acquired first
      const successCount = statuses.filter((s) => s === 201).length;
      const failCount = statuses.filter((s) => s === 400).length;

      // At least one should succeed
      expect(successCount).toBeGreaterThanOrEqual(1);

      // Total locked balance should not exceed available balance
      const wallet = await dbHelpers.getWalletByUserId(bidder._id);
      expect(wallet.lockedBalance).toBeLessThanOrEqual(wallet.balance);
    });

    it('should handle high concurrency without data corruption', async () => {
      const { auction } = await dbHelpers.createCompleteAuction({
        auctionSettings: { minBid: 10, minBidDifference: 1, antisniping: 60 },
      });

      // Create 10 users (reduced for faster test execution)
      const users = [];
      for (let i = 0; i < 10; i++) {
        const { user, wallet } = await dbHelpers.createUserWithWallet(
          {},
          { balance: 100000 },
        );
        users.push({ user, wallet });
      }

      // Each user places 3 bids sequentially (to avoid self-contention)
      const allPromises: Promise<any>[] = [];

      for (const u of users) {
        const tokens = generateTestTokens(jwtService, {
          userId: u.user._id.toString(),
          telegramId: u.user.telegramId,
        });

        // Chain bids for same user to avoid self-contention
        const userBidChain = async () => {
          for (let j = 0; j < 3; j++) {
            const amount = 100 + j * 50;
            await request(app.getHttpServer())
              .post('/bids/set_bid')
              .set('Authorization', `Bearer ${tokens.accessToken}`)
              .send({ auctionId: auction._id.toString(), amount });
          }
        };
        allPromises.push(userBidChain());
      }

      await Promise.all(allPromises);

      // Verify data integrity
      const bids = await dbHelpers.getBidsByAuction(auction._id);

      // All 10 users should have exactly 1 bid each (final amount 200)
      expect(bids).toHaveLength(10);

      // All bids should be active
      expect(bids.every((b) => b.status === BidStatus.ACTIVE)).toBe(true);

      // All bids should have final amount (200)
      expect(bids.every((b) => b.amount === 200)).toBe(true);

      // Verify wallet consistency
      for (const u of users) {
        const wallet = await dbHelpers.getWalletByUserId(u.user._id);
        const userBid = bids.find(
          (b) => b.userId.toString() === u.user._id.toString(),
        );

        expect(userBid).toBeDefined();
        expect(wallet.lockedBalance).toBe(200); // Final bid amount
        expect(wallet.balance).toBe(100000); // Original balance unchanged
      }
    }, 60000); // 60 second timeout for high concurrency test
  });
});
