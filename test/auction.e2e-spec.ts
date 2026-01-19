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
import { AuctionStatus } from 'src/models';

describe('AuctionController (e2e)', () => {
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

  describe('GET /auctions/get_list', () => {
    it('should return 401 without authentication', async () => {
      await request(app.getHttpServer())
        .post('/auctions/get_list')
        .send({ pagination: { page: 1, pageSize: 10 } })
        .expect(401);
    });

    it('should return empty list when no auctions exist', async () => {
      const { user } = await dbHelpers.createUserWithWallet();
      const tokens = generateTestTokens(jwtService, {
        userId: user._id.toString(),
        telegramId: user.telegramId,
      });

      const response = await request(app.getHttpServer())
        .post('/auctions/get_list')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ pagination: { page: 1, pageSize: 10 } })
        .expect(201);

      expect(response.body).toEqual({
        total: 0,
        pagination: { page: 1, pageSize: 10 },
        auctions: [],
      });
    });

    it('should return list of active auctions', async () => {
      const { user } = await dbHelpers.createUserWithWallet();
      const { auction } = await dbHelpers.createCompleteAuction();

      const tokens = generateTestTokens(jwtService, {
        userId: user._id.toString(),
        telegramId: user.telegramId,
      });

      const response = await request(app.getHttpServer())
        .post('/auctions/get_list')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ pagination: { page: 1, pageSize: 10 } })
        .expect(201);

      expect(response.body.total).toBe(1);
      expect(response.body.auctions).toHaveLength(1);
      expect(response.body.auctions[0].id).toBe(auction._id.toString());
      expect(response.body.auctions[0].status).toBe(AuctionStatus.ACTIVE);
    });

    it('should filter by status', async () => {
      const { user } = await dbHelpers.createUserWithWallet();
      const { auction: activeAuction } =
        await dbHelpers.createCompleteAuction();
      const { auction: endedAuction } = await dbHelpers.createCompleteAuction();
      await dbHelpers.updateAuctionStatus(
        endedAuction._id,
        AuctionStatus.ENDED,
      );

      const tokens = generateTestTokens(jwtService, {
        userId: user._id.toString(),
        telegramId: user.telegramId,
      });

      // Filter by ACTIVE status
      const activeResponse = await request(app.getHttpServer())
        .post('/auctions/get_list')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          filters: { status: [AuctionStatus.ACTIVE] },
          pagination: { page: 1, pageSize: 10 },
        })
        .expect(201);

      expect(activeResponse.body.total).toBe(1);
      expect(activeResponse.body.auctions[0].id).toBe(
        activeAuction._id.toString(),
      );

      // Filter by ENDED status
      const endedResponse = await request(app.getHttpServer())
        .post('/auctions/get_list')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          filters: { status: [AuctionStatus.ENDED] },
          pagination: { page: 1, pageSize: 10 },
        })
        .expect(201);

      expect(endedResponse.body.total).toBe(1);
      expect(endedResponse.body.auctions[0].id).toBe(
        endedAuction._id.toString(),
      );

      // Filter by both statuses
      const bothResponse = await request(app.getHttpServer())
        .post('/auctions/get_list')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          filters: { status: [AuctionStatus.ACTIVE, AuctionStatus.ENDED] },
          pagination: { page: 1, pageSize: 10 },
        })
        .expect(201);

      expect(bothResponse.body.total).toBe(2);
    });

    it('should filter by sellerId', async () => {
      const { user } = await dbHelpers.createUserWithWallet();
      const { seller: seller1, auction: auction1 } =
        await dbHelpers.createCompleteAuction();
      const { auction: auction2 } = await dbHelpers.createCompleteAuction();

      const tokens = generateTestTokens(jwtService, {
        userId: user._id.toString(),
        telegramId: user.telegramId,
      });

      const response = await request(app.getHttpServer())
        .post('/auctions/get_list')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          filters: { sellerId: seller1._id.toString() },
          pagination: { page: 1, pageSize: 10 },
        })
        .expect(201);

      expect(response.body.total).toBe(1);
      expect(response.body.auctions[0].id).toBe(auction1._id.toString());
    });

    it('should paginate results correctly', async () => {
      const { user } = await dbHelpers.createUserWithWallet();

      // Create 15 auctions
      for (let i = 0; i < 15; i++) {
        await dbHelpers.createCompleteAuction();
      }

      const tokens = generateTestTokens(jwtService, {
        userId: user._id.toString(),
        telegramId: user.telegramId,
      });

      // First page
      const page1Response = await request(app.getHttpServer())
        .post('/auctions/get_list')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ pagination: { page: 1, pageSize: 10 } })
        .expect(201);

      expect(page1Response.body.total).toBe(15);
      expect(page1Response.body.auctions).toHaveLength(10);

      // Second page
      const page2Response = await request(app.getHttpServer())
        .post('/auctions/get_list')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ pagination: { page: 2, pageSize: 10 } })
        .expect(201);

      expect(page2Response.body.total).toBe(15);
      expect(page2Response.body.auctions).toHaveLength(5);
    });

    it('should use default pagination when not provided', async () => {
      const { user } = await dbHelpers.createUserWithWallet();
      await dbHelpers.createCompleteAuction();

      const tokens = generateTestTokens(jwtService, {
        userId: user._id.toString(),
        telegramId: user.telegramId,
      });

      const response = await request(app.getHttpServer())
        .post('/auctions/get_list')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({})
        .expect(201);

      expect(response.body.pagination).toEqual({ page: 1, pageSize: 10 });
    });
  });

  describe('POST /auctions/get/:auction_id', () => {
    it('should return 401 without authentication', async () => {
      const fakeId = new Types.ObjectId().toString();
      await request(app.getHttpServer())
        .post(`/auctions/get/${fakeId}`)
        .expect(401);
    });

    it('should return 404 for non-existent auction', async () => {
      const { user } = await dbHelpers.createUserWithWallet();
      const tokens = generateTestTokens(jwtService, {
        userId: user._id.toString(),
        telegramId: user.telegramId,
      });
      const fakeId = new Types.ObjectId().toString();

      await request(app.getHttpServer())
        .post(`/auctions/get/${fakeId}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .expect(404);
    });

    it('should return auction details with items', async () => {
      const { user } = await dbHelpers.createUserWithWallet();
      const { seller, auction, items } = await dbHelpers.createCompleteAuction({
        itemCount: 3,
      });

      const tokens = generateTestTokens(jwtService, {
        userId: user._id.toString(),
        telegramId: user.telegramId,
      });

      const response = await request(app.getHttpServer())
        .post(`/auctions/get/${auction._id.toString()}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .expect(201);

      expect(response.body.auction).toBeDefined();
      expect(response.body.auction.id).toBe(auction._id.toString());
      expect(response.body.auction.sellerId).toBe(seller._id.toString());
      expect(response.body.auction.status).toBe(AuctionStatus.ACTIVE);
      expect(response.body.auction.settings).toEqual({
        antisniping: 60,
        minBid: 10,
        minBidDifference: 5,
      });

      // Check rounds with items
      expect(response.body.auction.rounds).toHaveLength(1);
      expect(response.body.auction.rounds[0].items).toHaveLength(3);
      expect(response.body.auction.rounds[0].items[0]).toMatchObject({
        num: items[0].num,
        collectionName: items[0].collectionName,
        value: items[0].value,
        ownerId: seller._id.toString(),
      });
    });

    it('should return auction with multiple rounds', async () => {
      const { user: seller, wallet: sellerWallet } =
        await dbHelpers.createUserWithWallet();
      const { user: requester } = await dbHelpers.createUserWithWallet();

      const items1 = await dbHelpers.createItems(2, seller._id, 'collection1');
      const items2 = await dbHelpers.createItems(2, seller._id, 'collection2');

      const now = new Date();
      const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
      const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);

      const auction = await dbHelpers.createAuction({
        sellerId: seller._id,
        sellerWalletId: sellerWallet._id,
        rounds: [
          {
            startTime: now,
            endTime: oneHourFromNow,
            status: AuctionStatus.ACTIVE,
            itemIds: items1.map((item) => item._id),
          },
          {
            startTime: oneHourFromNow,
            endTime: twoHoursFromNow,
            status: AuctionStatus.ACTIVE,
            itemIds: items2.map((item) => item._id),
          },
        ],
      });

      const tokens = generateTestTokens(jwtService, {
        userId: requester._id.toString(),
        telegramId: requester.telegramId,
      });

      const response = await request(app.getHttpServer())
        .post(`/auctions/get/${auction._id.toString()}`)
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .expect(201);

      expect(response.body.auction.rounds).toHaveLength(2);
      expect(response.body.auction.rounds[0].items).toHaveLength(2);
      expect(response.body.auction.rounds[1].items).toHaveLength(2);
    });
  });

  describe('Authentication Edge Cases', () => {
    it('should reject expired tokens', async () => {
      const { user } = await dbHelpers.createUserWithWallet();

      // Create an expired token manually
      const expiredToken = jwtService.sign(
        {
          userId: user._id.toString(),
          telegramId: user.telegramId,
          type: 'access',
        },
        { expiresIn: '-1s' },
      );

      await request(app.getHttpServer())
        .post('/auctions/get_list')
        .set('Authorization', `Bearer ${expiredToken}`)
        .send({ pagination: { page: 1, pageSize: 10 } })
        .expect(401);
    });

    it('should reject invalid token format', async () => {
      await request(app.getHttpServer())
        .post('/auctions/get_list')
        .set('Authorization', 'Bearer invalid-token')
        .send({ pagination: { page: 1, pageSize: 10 } })
        .expect(401);
    });

    it('should reject refresh token used as access token', async () => {
      const { user } = await dbHelpers.createUserWithWallet();
      const tokens = generateTestTokens(jwtService, {
        userId: user._id.toString(),
        telegramId: user.telegramId,
      });

      await request(app.getHttpServer())
        .post('/auctions/get_list')
        .set('Authorization', `Bearer ${tokens.refreshToken}`)
        .send({ pagination: { page: 1, pageSize: 10 } })
        .expect(401);
    });

    it('should reject missing Authorization header', async () => {
      await request(app.getHttpServer())
        .post('/auctions/get_list')
        .send({ pagination: { page: 1, pageSize: 10 } })
        .expect(401);
    });

    it('should reject non-Bearer authorization', async () => {
      const { user } = await dbHelpers.createUserWithWallet();
      const tokens = generateTestTokens(jwtService, {
        userId: user._id.toString(),
        telegramId: user.telegramId,
      });

      await request(app.getHttpServer())
        .post('/auctions/get_list')
        .set('Authorization', `Basic ${tokens.accessToken}`)
        .send({ pagination: { page: 1, pageSize: 10 } })
        .expect(401);
    });
  });

  describe('Validation', () => {
    it('should reject invalid pagination values', async () => {
      const { user } = await dbHelpers.createUserWithWallet();
      const tokens = generateTestTokens(jwtService, {
        userId: user._id.toString(),
        telegramId: user.telegramId,
      });

      // Negative page
      await request(app.getHttpServer())
        .post('/auctions/get_list')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ pagination: { page: -1, pageSize: 10 } })
        .expect(400);

      // Zero pageSize
      await request(app.getHttpServer())
        .post('/auctions/get_list')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ pagination: { page: 1, pageSize: 0 } })
        .expect(400);

      // Non-integer values
      await request(app.getHttpServer())
        .post('/auctions/get_list')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ pagination: { page: 'abc', pageSize: 10 } })
        .expect(400);
    });

    it('should reject invalid status filter', async () => {
      const { user } = await dbHelpers.createUserWithWallet();
      const tokens = generateTestTokens(jwtService, {
        userId: user._id.toString(),
        telegramId: user.telegramId,
      });

      await request(app.getHttpServer())
        .post('/auctions/get_list')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          filters: { status: ['invalid_status'] },
          pagination: { page: 1, pageSize: 10 },
        })
        .expect(400);
    });
  });
});
