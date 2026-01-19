import * as request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Types } from 'mongoose';

import {
  TestAppContext,
  createTestWebApp,
  closeTestApp,
  DbHelpers,
  generateTestTokens,
} from './utils';
import { AuctionStatus, BidStatus } from 'src/models';

describe('BidController (e2e)', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let dbHelpers: DbHelpers;
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestWebApp();
    app = ctx.app;
    jwtService = ctx.jwtService;
    dbHelpers = ctx.dbHelpers;
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  beforeEach(async () => {
    await dbHelpers.clearDatabase();
  });

  describe('POST /bids/set_bid', () => {
    it('should return 401 without authentication', async () => {
      const fakeAuctionId = new Types.ObjectId().toString();
      await request(app.getHttpServer())
        .post('/bids/set_bid')
        .send({ auctionId: fakeAuctionId, amount: 100 })
        .expect(401);
    });

    it('should place a bid successfully', async () => {
      const { auction } = await dbHelpers.createCompleteAuction({
        auctionSettings: { minBid: 10, minBidDifference: 5, antisniping: 60 },
      });
      const { user: bidder, wallet: bidderWallet } =
        await dbHelpers.createUserWithWallet({}, { balance: 1000 });

      const tokens = generateTestTokens(jwtService, {
        userId: bidder._id.toString(),
        telegramId: bidder.telegramId,
      });

      const response = await request(app.getHttpServer())
        .post('/bids/set_bid')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ auctionId: auction._id.toString(), amount: 100 })
        .expect(201);

      expect(response.body.status).toBe('ok');
      expect(response.body.data.amount).toBe(100);
      expect(response.body.data.newEndDate).toBeDefined();

      // Verify wallet balance was locked
      const updatedWallet = await dbHelpers.getWalletByUserId(bidder._id);
      expect(updatedWallet.lockedBalance).toBe(100);
      expect(updatedWallet.balance).toBe(1000); // Balance unchanged, only locked

      // Verify bid was created
      const bids = await dbHelpers.getBidsByAuction(auction._id);
      expect(bids).toHaveLength(1);
      expect(bids[0].userId.toString()).toBe(bidder._id.toString());
      expect(bids[0].amount).toBe(100);
      expect(bids[0].status).toBe(BidStatus.ACTIVE);
    });

    it('should update existing bid with higher amount', async () => {
      const { auction } = await dbHelpers.createCompleteAuction({
        auctionSettings: { minBid: 10, minBidDifference: 5, antisniping: 60 },
      });
      const { user: bidder } = await dbHelpers.createUserWithWallet(
        {},
        { balance: 1000 },
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

      // Update bid
      const response = await request(app.getHttpServer())
        .post('/bids/set_bid')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ auctionId: auction._id.toString(), amount: 150 })
        .expect(201);

      expect(response.body.status).toBe('ok');
      expect(response.body.data.amount).toBe(150);

      // Verify wallet - only difference should be additionally locked
      const updatedWallet = await dbHelpers.getWalletByUserId(bidder._id);
      expect(updatedWallet.lockedBalance).toBe(150);

      // Verify only one bid exists with updated amount
      const bids = await dbHelpers.getBidsByAuction(auction._id);
      expect(bids).toHaveLength(1);
      expect(bids[0].amount).toBe(150);
    });

    it('should reject bid below minimum bid', async () => {
      const { auction } = await dbHelpers.createCompleteAuction({
        auctionSettings: { minBid: 100, minBidDifference: 5, antisniping: 60 },
      });
      const { user: bidder } = await dbHelpers.createUserWithWallet(
        {},
        { balance: 1000 },
      );

      const tokens = generateTestTokens(jwtService, {
        userId: bidder._id.toString(),
        telegramId: bidder.telegramId,
      });

      await request(app.getHttpServer())
        .post('/bids/set_bid')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ auctionId: auction._id.toString(), amount: 50 })
        .expect(400);
    });

    it('should reject bid below minimum bid difference', async () => {
      const { auction } = await dbHelpers.createCompleteAuction({
        auctionSettings: { minBid: 10, minBidDifference: 20, antisniping: 60 },
      });
      const { user: bidder } = await dbHelpers.createUserWithWallet(
        {},
        { balance: 1000 },
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

      // Try to increase by less than minBidDifference
      await request(app.getHttpServer())
        .post('/bids/set_bid')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ auctionId: auction._id.toString(), amount: 110 }) // Only 10 more, need 20
        .expect(400);
    });

    it('should reject bid when user has insufficient balance', async () => {
      const { auction } = await dbHelpers.createCompleteAuction({
        auctionSettings: { minBid: 10, minBidDifference: 5, antisniping: 60 },
      });
      const { user: bidder } = await dbHelpers.createUserWithWallet(
        {},
        { balance: 50 },
      );

      const tokens = generateTestTokens(jwtService, {
        userId: bidder._id.toString(),
        telegramId: bidder.telegramId,
      });

      await request(app.getHttpServer())
        .post('/bids/set_bid')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ auctionId: auction._id.toString(), amount: 100 })
        .expect(400);
    });

    it('should reject bid when user balance is locked', async () => {
      const { auction } = await dbHelpers.createCompleteAuction({
        auctionSettings: { minBid: 10, minBidDifference: 5, antisniping: 60 },
      });
      const { user: bidder } = await dbHelpers.createUserWithWallet(
        {},
        { balance: 100, lockedBalance: 90 }, // Only 10 free
      );

      const tokens = generateTestTokens(jwtService, {
        userId: bidder._id.toString(),
        telegramId: bidder.telegramId,
      });

      await request(app.getHttpServer())
        .post('/bids/set_bid')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ auctionId: auction._id.toString(), amount: 50 })
        .expect(400);
    });

    it('should reject bid for non-existent auction', async () => {
      const { user: bidder } = await dbHelpers.createUserWithWallet(
        {},
        { balance: 1000 },
      );
      const fakeAuctionId = new Types.ObjectId().toString();

      const tokens = generateTestTokens(jwtService, {
        userId: bidder._id.toString(),
        telegramId: bidder.telegramId,
      });

      await request(app.getHttpServer())
        .post('/bids/set_bid')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ auctionId: fakeAuctionId, amount: 100 })
        .expect(404);
    });

    it('should reject bid for ended auction', async () => {
      const { auction } = await dbHelpers.createCompleteAuction();
      await dbHelpers.updateAuctionStatus(auction._id, AuctionStatus.ENDED);

      const { user: bidder } = await dbHelpers.createUserWithWallet(
        {},
        { balance: 1000 },
      );

      const tokens = generateTestTokens(jwtService, {
        userId: bidder._id.toString(),
        telegramId: bidder.telegramId,
      });

      await request(app.getHttpServer())
        .post('/bids/set_bid')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ auctionId: auction._id.toString(), amount: 100 })
        .expect(400);
    });

    it('should reject bid for cancelled auction', async () => {
      const { auction } = await dbHelpers.createCompleteAuction();
      await dbHelpers.updateAuctionStatus(auction._id, AuctionStatus.CANCELLED);

      const { user: bidder } = await dbHelpers.createUserWithWallet(
        {},
        { balance: 1000 },
      );

      const tokens = generateTestTokens(jwtService, {
        userId: bidder._id.toString(),
        telegramId: bidder.telegramId,
      });

      await request(app.getHttpServer())
        .post('/bids/set_bid')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ auctionId: auction._id.toString(), amount: 100 })
        .expect(400);
    });

    it('should reject bid for expired auction round', async () => {
      const pastDate = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
      const { auction } = await dbHelpers.createCompleteAuction({
        roundEndTime: pastDate,
      });

      const { user: bidder } = await dbHelpers.createUserWithWallet(
        {},
        { balance: 1000 },
      );

      const tokens = generateTestTokens(jwtService, {
        userId: bidder._id.toString(),
        telegramId: bidder.telegramId,
      });

      await request(app.getHttpServer())
        .post('/bids/set_bid')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ auctionId: auction._id.toString(), amount: 100 })
        .expect(400);
    });

    it('should reject decreasing bid amount', async () => {
      const { auction } = await dbHelpers.createCompleteAuction({
        auctionSettings: { minBid: 10, minBidDifference: 5, antisniping: 60 },
      });
      const { user: bidder } = await dbHelpers.createUserWithWallet(
        {},
        { balance: 1000 },
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

      // Try to decrease bid
      await request(app.getHttpServer())
        .post('/bids/set_bid')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ auctionId: auction._id.toString(), amount: 50 })
        .expect(400);
    });

    it('should create transaction record when placing bid', async () => {
      const { auction } = await dbHelpers.createCompleteAuction({
        auctionSettings: { minBid: 10, minBidDifference: 5, antisniping: 60 },
      });
      const { user: bidder } = await dbHelpers.createUserWithWallet(
        {},
        { balance: 1000 },
      );

      const tokens = generateTestTokens(jwtService, {
        userId: bidder._id.toString(),
        telegramId: bidder.telegramId,
      });

      await request(app.getHttpServer())
        .post('/bids/set_bid')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ auctionId: auction._id.toString(), amount: 100 })
        .expect(201);

      const transactions = await dbHelpers.getTransactions();
      expect(transactions.length).toBeGreaterThanOrEqual(1);
      const bidTransaction = transactions.find((t) => t.type === 'BID');
      expect(bidTransaction).toBeDefined();
      expect(bidTransaction.amount).toBe(100);
    });

    it('should handle multiple bidders on same auction', async () => {
      const { auction } = await dbHelpers.createCompleteAuction({
        auctionSettings: { minBid: 10, minBidDifference: 5, antisniping: 60 },
      });

      const { user: bidder1 } = await dbHelpers.createUserWithWallet(
        {},
        { balance: 1000 },
      );
      const { user: bidder2 } = await dbHelpers.createUserWithWallet(
        {},
        { balance: 1000 },
      );

      const tokens1 = generateTestTokens(jwtService, {
        userId: bidder1._id.toString(),
        telegramId: bidder1.telegramId,
      });
      const tokens2 = generateTestTokens(jwtService, {
        userId: bidder2._id.toString(),
        telegramId: bidder2.telegramId,
      });

      // Bidder 1 places bid
      await request(app.getHttpServer())
        .post('/bids/set_bid')
        .set('Authorization', `Bearer ${tokens1.accessToken}`)
        .send({ auctionId: auction._id.toString(), amount: 100 })
        .expect(201);

      // Bidder 2 places bid
      await request(app.getHttpServer())
        .post('/bids/set_bid')
        .set('Authorization', `Bearer ${tokens2.accessToken}`)
        .send({ auctionId: auction._id.toString(), amount: 150 })
        .expect(201);

      // Verify both bids exist
      const bids = await dbHelpers.getBidsByAuction(auction._id);
      expect(bids).toHaveLength(2);
      expect(bids.map((b) => b.amount).sort()).toEqual([100, 150]);
    });
  });

  describe('POST /bids/get_my', () => {
    it('should return 401 without authentication', async () => {
      await request(app.getHttpServer()).post('/bids/get_my').expect(401);
    });

    it('should return empty list when user has no bids', async () => {
      const { user } = await dbHelpers.createUserWithWallet();

      const tokens = generateTestTokens(jwtService, {
        userId: user._id.toString(),
        telegramId: user.telegramId,
      });

      const response = await request(app.getHttpServer())
        .post('/bids/get_my')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .expect(201);

      expect(response.body.bids).toEqual([]);
    });

    it('should return user bids', async () => {
      const { auction } = await dbHelpers.createCompleteAuction({
        auctionSettings: { minBid: 10, minBidDifference: 5, antisniping: 60 },
      });
      const { user: bidder } = await dbHelpers.createUserWithWallet(
        {},
        { balance: 1000 },
      );

      const tokens = generateTestTokens(jwtService, {
        userId: bidder._id.toString(),
        telegramId: bidder.telegramId,
      });

      // Place a bid
      await request(app.getHttpServer())
        .post('/bids/set_bid')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ auctionId: auction._id.toString(), amount: 100 })
        .expect(201);

      // Get my bids
      const response = await request(app.getHttpServer())
        .post('/bids/get_my')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .expect(201);

      expect(response.body.bids).toHaveLength(1);
      expect(response.body.bids[0]).toMatchObject({
        userId: bidder._id.toString(),
        auctionId: auction._id.toString(),
        amount: 100,
        status: BidStatus.ACTIVE,
      });
    });

    it('should return multiple bids across different auctions', async () => {
      const { auction: auction1 } = await dbHelpers.createCompleteAuction({
        auctionSettings: { minBid: 10, minBidDifference: 5, antisniping: 60 },
      });
      const { auction: auction2 } = await dbHelpers.createCompleteAuction({
        auctionSettings: { minBid: 10, minBidDifference: 5, antisniping: 60 },
      });
      const { user: bidder } = await dbHelpers.createUserWithWallet(
        {},
        { balance: 1000 },
      );

      const tokens = generateTestTokens(jwtService, {
        userId: bidder._id.toString(),
        telegramId: bidder.telegramId,
      });

      // Place bids on both auctions
      await request(app.getHttpServer())
        .post('/bids/set_bid')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ auctionId: auction1._id.toString(), amount: 100 })
        .expect(201);

      await request(app.getHttpServer())
        .post('/bids/set_bid')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ auctionId: auction2._id.toString(), amount: 200 })
        .expect(201);

      // Get my bids
      const response = await request(app.getHttpServer())
        .post('/bids/get_my')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .expect(201);

      expect(response.body.bids).toHaveLength(2);
    });

    it('should not return other users bids', async () => {
      const { auction } = await dbHelpers.createCompleteAuction({
        auctionSettings: { minBid: 10, minBidDifference: 5, antisniping: 60 },
      });
      const { user: bidder1 } = await dbHelpers.createUserWithWallet(
        {},
        { balance: 1000 },
      );
      const { user: bidder2 } = await dbHelpers.createUserWithWallet(
        {},
        { balance: 1000 },
      );

      const tokens1 = generateTestTokens(jwtService, {
        userId: bidder1._id.toString(),
        telegramId: bidder1.telegramId,
      });
      const tokens2 = generateTestTokens(jwtService, {
        userId: bidder2._id.toString(),
        telegramId: bidder2.telegramId,
      });

      // Both users place bids
      await request(app.getHttpServer())
        .post('/bids/set_bid')
        .set('Authorization', `Bearer ${tokens1.accessToken}`)
        .send({ auctionId: auction._id.toString(), amount: 100 })
        .expect(201);

      await request(app.getHttpServer())
        .post('/bids/set_bid')
        .set('Authorization', `Bearer ${tokens2.accessToken}`)
        .send({ auctionId: auction._id.toString(), amount: 150 })
        .expect(201);

      // User 1 should only see their own bid
      const response = await request(app.getHttpServer())
        .post('/bids/get_my')
        .set('Authorization', `Bearer ${tokens1.accessToken}`)
        .expect(201);

      expect(response.body.bids).toHaveLength(1);
      expect(response.body.bids[0].amount).toBe(100);
    });
  });

  describe('POST /bids/get_by_auction/:auction_id', () => {
    it('should return 401 without authentication', async () => {
      const fakeAuctionId = new Types.ObjectId().toString();
      await request(app.getHttpServer())
        .post(`/bids/get_by_auction/${fakeAuctionId}`)
        .expect(401);
    });

    it('should return empty bids for auction with no bids', async () => {
      const { auction } = await dbHelpers.createCompleteAuction();
      const { user } = await dbHelpers.createUserWithWallet();

      const tokens = generateTestTokens(jwtService, {
        userId: user._id.toString(),
        telegramId: user.telegramId,
      });

      const response = await request(app.getHttpServer())
        .post(`/bids/get_by_auction/${auction._id.toString()}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .expect(201);

      expect(response.body.my_bids).toBeNull();
      expect(response.body.top_bids).toEqual([]);
    });

    it('should return top bids and user bid for auction', async () => {
      const { auction } = await dbHelpers.createCompleteAuction({
        auctionSettings: { minBid: 10, minBidDifference: 5, antisniping: 60 },
      });
      const { user: bidder1 } = await dbHelpers.createUserWithWallet(
        {},
        { balance: 1000 },
      );
      const { user: bidder2 } = await dbHelpers.createUserWithWallet(
        {},
        { balance: 1000 },
      );

      const tokens1 = generateTestTokens(jwtService, {
        userId: bidder1._id.toString(),
        telegramId: bidder1.telegramId,
      });
      const tokens2 = generateTestTokens(jwtService, {
        userId: bidder2._id.toString(),
        telegramId: bidder2.telegramId,
      });

      // Both users place bids
      await request(app.getHttpServer())
        .post('/bids/set_bid')
        .set('Authorization', `Bearer ${tokens1.accessToken}`)
        .send({ auctionId: auction._id.toString(), amount: 100 })
        .expect(201);

      await request(app.getHttpServer())
        .post('/bids/set_bid')
        .set('Authorization', `Bearer ${tokens2.accessToken}`)
        .send({ auctionId: auction._id.toString(), amount: 150 })
        .expect(201);

      // Get bids by auction for user 1
      const response = await request(app.getHttpServer())
        .post(`/bids/get_by_auction/${auction._id.toString()}`)
        .set('Authorization', `Bearer ${tokens1.accessToken}`)
        .expect(201);

      expect(response.body.my_bids).toBeDefined();
      expect(response.body.my_bids.amount).toBe(100);
      expect(response.body.top_bids).toHaveLength(2);
      expect(response.body.top_bids[0].amount).toBe(150); // Highest first
      expect(response.body.top_bids[1].amount).toBe(100);
    });

    it('should return null for my_bids when user has not bid', async () => {
      const { auction } = await dbHelpers.createCompleteAuction({
        auctionSettings: { minBid: 10, minBidDifference: 5, antisniping: 60 },
      });
      const { user: bidder } = await dbHelpers.createUserWithWallet(
        {},
        { balance: 1000 },
      );
      const { user: viewer } = await dbHelpers.createUserWithWallet();

      const bidderTokens = generateTestTokens(jwtService, {
        userId: bidder._id.toString(),
        telegramId: bidder.telegramId,
      });
      const viewerTokens = generateTestTokens(jwtService, {
        userId: viewer._id.toString(),
        telegramId: viewer.telegramId,
      });

      // Bidder places a bid
      await request(app.getHttpServer())
        .post('/bids/set_bid')
        .set('Authorization', `Bearer ${bidderTokens.accessToken}`)
        .send({ auctionId: auction._id.toString(), amount: 100 })
        .expect(201);

      // Viewer (who didn't bid) gets auction bids
      const response = await request(app.getHttpServer())
        .post(`/bids/get_by_auction/${auction._id.toString()}`)
        .set('Authorization', `Bearer ${viewerTokens.accessToken}`)
        .expect(201);

      expect(response.body.my_bids).toBeNull();
      expect(response.body.top_bids).toHaveLength(1);
    });

    it('should limit top bids to 10', async () => {
      const { auction } = await dbHelpers.createCompleteAuction({
        auctionSettings: { minBid: 10, minBidDifference: 1, antisniping: 60 },
      });

      // Create 15 bidders
      const bidders = [];
      for (let i = 0; i < 15; i++) {
        const { user } = await dbHelpers.createUserWithWallet(
          {},
          { balance: 10000 },
        );
        bidders.push(user);
      }

      // Each bidder places a bid
      for (let i = 0; i < bidders.length; i++) {
        const tokens = generateTestTokens(jwtService, {
          userId: bidders[i]._id.toString(),
          telegramId: bidders[i].telegramId,
        });

        await request(app.getHttpServer())
          .post('/bids/set_bid')
          .set('Authorization', `Bearer ${tokens.accessToken}`)
          .send({ auctionId: auction._id.toString(), amount: 100 + i * 10 })
          .expect(201);
      }

      // Get top bids
      const tokens = generateTestTokens(jwtService, {
        userId: bidders[0]._id.toString(),
        telegramId: bidders[0].telegramId,
      });

      const response = await request(app.getHttpServer())
        .post(`/bids/get_by_auction/${auction._id.toString()}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .expect(201);

      expect(response.body.top_bids).toHaveLength(10);
      // Should be sorted by amount descending
      expect(response.body.top_bids[0].amount).toBe(240); // 100 + 14*10
    });
  });

  describe('Validation', () => {
    it('should reject invalid auction ID format', async () => {
      const { user } = await dbHelpers.createUserWithWallet(
        {},
        { balance: 1000 },
      );

      const tokens = generateTestTokens(jwtService, {
        userId: user._id.toString(),
        telegramId: user.telegramId,
      });

      await request(app.getHttpServer())
        .post('/bids/set_bid')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ auctionId: 'invalid-id', amount: 100 })
        .expect(400);
    });

    it('should reject negative bid amount', async () => {
      const { auction } = await dbHelpers.createCompleteAuction();
      const { user } = await dbHelpers.createUserWithWallet(
        {},
        { balance: 1000 },
      );

      const tokens = generateTestTokens(jwtService, {
        userId: user._id.toString(),
        telegramId: user.telegramId,
      });

      await request(app.getHttpServer())
        .post('/bids/set_bid')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ auctionId: auction._id.toString(), amount: -100 })
        .expect(400);
    });

    it('should reject zero bid amount', async () => {
      const { auction } = await dbHelpers.createCompleteAuction();
      const { user } = await dbHelpers.createUserWithWallet(
        {},
        { balance: 1000 },
      );

      const tokens = generateTestTokens(jwtService, {
        userId: user._id.toString(),
        telegramId: user.telegramId,
      });

      await request(app.getHttpServer())
        .post('/bids/set_bid')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ auctionId: auction._id.toString(), amount: 0 })
        .expect(400);
    });

    it('should reject non-integer bid amount', async () => {
      const { auction } = await dbHelpers.createCompleteAuction();
      const { user } = await dbHelpers.createUserWithWallet(
        {},
        { balance: 1000 },
      );

      const tokens = generateTestTokens(jwtService, {
        userId: user._id.toString(),
        telegramId: user.telegramId,
      });

      await request(app.getHttpServer())
        .post('/bids/set_bid')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ auctionId: auction._id.toString(), amount: 100.5 })
        .expect(400);
    });

    it('should reject missing auctionId', async () => {
      const { user } = await dbHelpers.createUserWithWallet(
        {},
        { balance: 1000 },
      );

      const tokens = generateTestTokens(jwtService, {
        userId: user._id.toString(),
        telegramId: user.telegramId,
      });

      await request(app.getHttpServer())
        .post('/bids/set_bid')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ amount: 100 })
        .expect(400);
    });

    it('should reject missing amount', async () => {
      const { auction } = await dbHelpers.createCompleteAuction();
      const { user } = await dbHelpers.createUserWithWallet(
        {},
        { balance: 1000 },
      );

      const tokens = generateTestTokens(jwtService, {
        userId: user._id.toString(),
        telegramId: user.telegramId,
      });

      await request(app.getHttpServer())
        .post('/bids/set_bid')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ auctionId: auction._id.toString() })
        .expect(400);
    });
  });
});
