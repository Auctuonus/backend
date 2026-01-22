import * as request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { Types } from 'mongoose';

import {
  TestRunnerContext,
  createFullTestApp,
  closeTestApp,
  DbHelpers,
  generateTestTokens,
} from './utils';
import { AuctionStatus, BidStatus } from 'src/models';
import { AuctionProcessingService } from 'src/auctions/auction.consumer';
import { JobMessage } from 'src/auctions/dto';

/**
 * Integration tests that test the full auction flow:
 * 1. Create auction (via DB helpers - simulating admin creation)
 * 2. Users browse auctions via web API
 * 3. Users place bids via web API
 * 4. Auction ends and runner processes results
 * 5. Verify final state
 */
describe('Full Auction Flow Integration (e2e)', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let dbHelpers: DbHelpers;
  let auctionProcessor: AuctionProcessingService;
  let amqpConnection: AmqpConnection;
  let ctx: TestRunnerContext;

  beforeAll(async () => {
    ctx = await createFullTestApp();
    app = ctx.app;
    jwtService = ctx.jwtService;
    dbHelpers = ctx.dbHelpers;
    auctionProcessor = ctx.auctionProcessor;
    amqpConnection = ctx.amqpConnection;
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  beforeEach(async () => {
    await dbHelpers.clearDatabase();
  });

  function createJobMessage(auctionId: string): JobMessage {
    return {
      id: randomUUID(),
      auctionId,
      publishedAt: new Date(),
    };
  }

  describe('Complete Auction Lifecycle', () => {
    it('should handle full auction lifecycle from creation to completion', async () => {
      // Step 1: Create auction with items
      const { seller, sellerWallet, items, auction } =
        await dbHelpers.createCompleteAuction({
          itemCount: 3,
          sellerBalance: 0,
          auctionSettings: {
            minBid: 50,
            minBidDifference: 10,
            antisniping: 60,
          },
        });

      // Step 2: Create bidders with wallets
      const { user: bidder1, wallet: wallet1 } =
        await dbHelpers.createUserWithWallet({}, { balance: 1000 });
      const { user: bidder2, wallet: wallet2 } =
        await dbHelpers.createUserWithWallet({}, { balance: 1000 });
      const { user: bidder3, wallet: wallet3 } =
        await dbHelpers.createUserWithWallet({}, { balance: 500 });

      const tokens1 = generateTestTokens(jwtService, {
        userId: bidder1._id.toString(),
        telegramId: bidder1.telegramId,
      });
      const tokens2 = generateTestTokens(jwtService, {
        userId: bidder2._id.toString(),
        telegramId: bidder2.telegramId,
      });
      const tokens3 = generateTestTokens(jwtService, {
        userId: bidder3._id.toString(),
        telegramId: bidder3.telegramId,
      });

      // Step 3: Bidders browse available auctions
      const listResponse = await request(app.getHttpServer())
        .post('/auctions/get_list')
        .set('Authorization', `Bearer ${tokens1.accessToken}`)
        .send({ pagination: { page: 1, pageSize: 10 } })
        .expect(201);

      expect(listResponse.body.total).toBe(1);
      expect(listResponse.body.auctions[0].id).toBe(auction._id.toString());

      // Step 4: Bidder views auction details
      const detailResponse = await request(app.getHttpServer())
        .post(`/auctions/get/${auction._id.toString()}`)
        .set('Authorization', `Bearer ${tokens1.accessToken}`)
        .expect(201);

      expect(detailResponse.body.auction.rounds[0].items).toHaveLength(3);

      // Step 5: Bidders place bids
      // Bidder 1 places bid
      await request(app.getHttpServer())
        .post('/bids/set_bid')
        .set('Authorization', `Bearer ${tokens1.accessToken}`)
        .send({ auctionId: auction._id.toString(), amount: 100 })
        .expect(201);

      // Bidder 2 places higher bid
      await request(app.getHttpServer())
        .post('/bids/set_bid')
        .set('Authorization', `Bearer ${tokens2.accessToken}`)
        .send({ auctionId: auction._id.toString(), amount: 150 })
        .expect(201);

      // Bidder 3 places bid
      await request(app.getHttpServer())
        .post('/bids/set_bid')
        .set('Authorization', `Bearer ${tokens3.accessToken}`)
        .send({ auctionId: auction._id.toString(), amount: 80 })
        .expect(201);

      // Step 6: Bidder 1 increases their bid
      await request(app.getHttpServer())
        .post('/bids/set_bid')
        .set('Authorization', `Bearer ${tokens1.accessToken}`)
        .send({ auctionId: auction._id.toString(), amount: 200 })
        .expect(201);

      // Step 7: Check bids for auction
      const bidsResponse = await request(app.getHttpServer())
        .post(`/bids/get_by_auction/${auction._id.toString()}`)
        .set('Authorization', `Bearer ${tokens1.accessToken}`)
        .expect(201);

      expect(bidsResponse.body.my_bids.amount).toBe(200);
      expect(bidsResponse.body.top_bids).toHaveLength(3);
      expect(bidsResponse.body.top_bids[0].amount).toBe(200); // Highest first

      // Step 8: Verify wallet balances are locked
      const wallet1Updated = await dbHelpers.getWalletByUserId(bidder1._id);
      const wallet2Updated = await dbHelpers.getWalletByUserId(bidder2._id);
      const wallet3Updated = await dbHelpers.getWalletByUserId(bidder3._id);

      expect(wallet1Updated.lockedBalance).toBe(200);
      expect(wallet2Updated.lockedBalance).toBe(150);
      expect(wallet3Updated.lockedBalance).toBe(80);

      // Step 9: Simulate auction end by updating round end time
      await dbHelpers.updateAuctionRoundEndTime(
        auction._id,
        0,
        new Date(Date.now() - 1000),
      );

      // Step 10: Process auction (simulates RabbitMQ message)
      const processResult = await auctionProcessor.processAuctionSync(
        createJobMessage(auction._id.toString()),
      );

      expect(processResult).toBeNull(); // Success

      // Step 11: Verify final state
      // Auction should be ended
      const finalAuction = await dbHelpers.getAuction(auction._id);
      expect(finalAuction.status).toBe(AuctionStatus.ENDED);

      // Bids should be marked as won/lost
      const finalBids = await dbHelpers.getBidsByAuction(auction._id);
      const wonBids = finalBids.filter((b) => b.status === BidStatus.WON);
      const lostBids = finalBids.filter((b) => b.status === BidStatus.LOST);

      // 3 items = 3 winners
      expect(wonBids).toHaveLength(3);

      // Seller should receive total payment
      const sellerWalletFinal = await dbHelpers.getWalletByUserId(seller._id);
      const totalWinningBids = wonBids.reduce((sum, b) => sum + b.amount, 0);
      expect(sellerWalletFinal.balance).toBe(totalWinningBids);

      // Winners' locked balance should be cleared
      const wallet1Final = await dbHelpers.getWalletByUserId(bidder1._id);
      const wallet2Final = await dbHelpers.getWalletByUserId(bidder2._id);
      const wallet3Final = await dbHelpers.getWalletByUserId(bidder3._id);

      // Winning bidders have their locked balance deducted along with balance
      expect(wallet1Final.lockedBalance).toBe(0);
      expect(wallet2Final.lockedBalance).toBe(0);
      expect(wallet3Final.lockedBalance).toBe(0);

      // Step 12: Verify auction no longer accepts bids
      await request(app.getHttpServer())
        .post('/bids/set_bid')
        .set('Authorization', `Bearer ${tokens1.accessToken}`)
        .send({ auctionId: auction._id.toString(), amount: 500 })
        .expect(400);
    });

    it('should handle competitive bidding scenario', async () => {
      const { seller, auction } = await dbHelpers.createCompleteAuction({
        itemCount: 1,
        sellerBalance: 0,
        auctionSettings: {
          minBid: 10,
          minBidDifference: 5,
          antisniping: 60,
        },
      });

      // Create 5 competitive bidders
      const bidders = [];
      for (let i = 0; i < 5; i++) {
        const { user, wallet } = await dbHelpers.createUserWithWallet(
          {},
          { balance: 1000 },
        );
        const tokens = generateTestTokens(jwtService, {
          userId: user._id.toString(),
          telegramId: user.telegramId,
        });
        bidders.push({ user, wallet, tokens });
      }

      // Bidding war!
      await request(app.getHttpServer())
        .post('/bids/set_bid')
        .set('Authorization', `Bearer ${bidders[0].tokens.accessToken}`)
        .send({ auctionId: auction._id.toString(), amount: 50 })
        .expect(201);

      await request(app.getHttpServer())
        .post('/bids/set_bid')
        .set('Authorization', `Bearer ${bidders[1].tokens.accessToken}`)
        .send({ auctionId: auction._id.toString(), amount: 75 })
        .expect(201);

      await request(app.getHttpServer())
        .post('/bids/set_bid')
        .set('Authorization', `Bearer ${bidders[2].tokens.accessToken}`)
        .send({ auctionId: auction._id.toString(), amount: 100 })
        .expect(201);

      // Bidder 0 increases
      await request(app.getHttpServer())
        .post('/bids/set_bid')
        .set('Authorization', `Bearer ${bidders[0].tokens.accessToken}`)
        .send({ auctionId: auction._id.toString(), amount: 150 })
        .expect(201);

      await request(app.getHttpServer())
        .post('/bids/set_bid')
        .set('Authorization', `Bearer ${bidders[3].tokens.accessToken}`)
        .send({ auctionId: auction._id.toString(), amount: 200 })
        .expect(201);

      // Final bid by bidder 4
      await request(app.getHttpServer())
        .post('/bids/set_bid')
        .set('Authorization', `Bearer ${bidders[4].tokens.accessToken}`)
        .send({ auctionId: auction._id.toString(), amount: 250 })
        .expect(201);

      // End auction
      await dbHelpers.updateAuctionRoundEndTime(
        auction._id,
        0,
        new Date(Date.now() - 1000),
      );
      await auctionProcessor.processAuctionSync(
        createJobMessage(auction._id.toString()),
      );

      // Verify bidder 4 won
      const bids = await dbHelpers.getBidsByAuction(auction._id);
      const wonBid = bids.find((b) => b.status === BidStatus.WON);
      expect(wonBid.userId.toString()).toBe(bidders[4].user._id.toString());
      expect(wonBid.amount).toBe(250);

      // Seller received 250
      const sellerWallet = await dbHelpers.getWalletByUserId(seller._id);
      expect(sellerWallet.balance).toBe(250);
    });

    it('should handle auction with insufficient funds attempt', async () => {
      const { auction } = await dbHelpers.createCompleteAuction({
        itemCount: 1,
        auctionSettings: {
          minBid: 100,
          minBidDifference: 10,
          antisniping: 60,
        },
      });

      // User with low balance
      const { user: poorUser, wallet } = await dbHelpers.createUserWithWallet(
        {},
        { balance: 50 },
      );
      const tokens = generateTestTokens(jwtService, {
        userId: poorUser._id.toString(),
        telegramId: poorUser.telegramId,
      });

      // Should fail - not enough balance
      await request(app.getHttpServer())
        .post('/bids/set_bid')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ auctionId: auction._id.toString(), amount: 100 })
        .expect(400);

      // Wallet should be unchanged
      const walletAfter = await dbHelpers.getWalletByUserId(poorUser._id);
      expect(walletAfter.balance).toBe(50);
      expect(walletAfter.lockedBalance).toBe(0);
    });

    it('should track user bids across multiple auctions', async () => {
      // Create 3 auctions
      const auctions = [];
      for (let i = 0; i < 3; i++) {
        const { auction } = await dbHelpers.createCompleteAuction({
          itemCount: 1,
          auctionSettings: {
            minBid: 10,
            minBidDifference: 5,
            antisniping: 60,
          },
        });
        auctions.push(auction);
      }

      // Create bidder
      const { user: bidder } = await dbHelpers.createUserWithWallet(
        {},
        { balance: 10000 },
      );
      const tokens = generateTestTokens(jwtService, {
        userId: bidder._id.toString(),
        telegramId: bidder.telegramId,
      });

      // Place bids on all auctions
      for (let i = 0; i < auctions.length; i++) {
        await request(app.getHttpServer())
          .post('/bids/set_bid')
          .set('Authorization', `Bearer ${tokens.accessToken}`)
          .send({
            auctionId: auctions[i]._id.toString(),
            amount: 100 * (i + 1),
          })
          .expect(201);
      }

      // Check my bids
      const myBidsResponse = await request(app.getHttpServer())
        .post('/bids/get_my')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .expect(201);

      expect(myBidsResponse.body.bids).toHaveLength(3);
      const amounts = myBidsResponse.body.bids
        .map((b) => b.amount)
        .sort((a, b) => a - b);
      expect(amounts).toEqual([100, 200, 300]);

      // Verify locked balance
      const wallet = await dbHelpers.getWalletByUserId(bidder._id);
      expect(wallet.lockedBalance).toBe(600); // 100 + 200 + 300
    });
  });

  describe('Error Recovery', () => {
    it('should handle failed bid gracefully without corrupting state', async () => {
      const { auction } = await dbHelpers.createCompleteAuction({
        itemCount: 1,
        auctionSettings: {
          minBid: 100,
          minBidDifference: 10,
          antisniping: 60,
        },
      });

      const { user, wallet } = await dbHelpers.createUserWithWallet(
        {},
        { balance: 500 },
      );
      const tokens = generateTestTokens(jwtService, {
        userId: user._id.toString(),
        telegramId: user.telegramId,
      });

      // Place initial successful bid
      await request(app.getHttpServer())
        .post('/bids/set_bid')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ auctionId: auction._id.toString(), amount: 200 })
        .expect(201);

      // Try to place bid that would exceed free balance
      // Balance: 500, Locked: 200, Free: 300
      // Trying to increase by 400 (to 600 total) should fail
      await request(app.getHttpServer())
        .post('/bids/set_bid')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ auctionId: auction._id.toString(), amount: 600 })
        .expect(400);

      // Verify state is unchanged
      const walletAfter = await dbHelpers.getWalletByUserId(user._id);
      expect(walletAfter.lockedBalance).toBe(200); // Still original amount

      const bids = await dbHelpers.getBidsByAuction(auction._id);
      expect(bids).toHaveLength(1);
      expect(bids[0].amount).toBe(200);
    });

    it('should handle auction becoming inactive during bid attempt', async () => {
      const { auction } = await dbHelpers.createCompleteAuction({
        itemCount: 1,
        auctionSettings: {
          minBid: 10,
          minBidDifference: 5,
          antisniping: 60,
        },
      });

      const { user } = await dbHelpers.createUserWithWallet(
        {},
        { balance: 1000 },
      );
      const tokens = generateTestTokens(jwtService, {
        userId: user._id.toString(),
        telegramId: user.telegramId,
      });

      // End auction
      await dbHelpers.updateAuctionStatus(auction._id, AuctionStatus.ENDED);

      // Try to bid
      await request(app.getHttpServer())
        .post('/bids/set_bid')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ auctionId: auction._id.toString(), amount: 100 })
        .expect(400);

      // No bids should exist
      const bids = await dbHelpers.getBidsByAuction(auction._id);
      expect(bids).toHaveLength(0);
    });
  });

  describe('Full Flow with RabbitMQ', () => {
    it('should process auction via RabbitMQ message queue', async () => {
      // Step 1: Create auction with items
      const { seller, auction } = await dbHelpers.createCompleteAuction({
        itemCount: 2,
        sellerBalance: 0,
        auctionSettings: {
          minBid: 100,
          minBidDifference: 20,
          antisniping: 60,
        },
      });

      // Step 2: Create bidders
      const { user: bidder1, wallet: wallet1 } =
        await dbHelpers.createUserWithWallet({}, { balance: 1000 });
      const { user: bidder2, wallet: wallet2 } =
        await dbHelpers.createUserWithWallet({}, { balance: 1000 });

      const tokens1 = generateTestTokens(jwtService, {
        userId: bidder1._id.toString(),
        telegramId: bidder1.telegramId,
      });
      const tokens2 = generateTestTokens(jwtService, {
        userId: bidder2._id.toString(),
        telegramId: bidder2.telegramId,
      });

      // Step 3: Place bids via API
      await request(app.getHttpServer())
        .post('/bids/set_bid')
        .set('Authorization', `Bearer ${tokens1.accessToken}`)
        .send({ auctionId: auction._id.toString(), amount: 150 })
        .expect(201);

      await request(app.getHttpServer())
        .post('/bids/set_bid')
        .set('Authorization', `Bearer ${tokens2.accessToken}`)
        .send({ auctionId: auction._id.toString(), amount: 200 })
        .expect(201);

      // Step 4: End auction
      await dbHelpers.updateAuctionRoundEndTime(
        auction._id,
        0,
        new Date(Date.now() - 1000),
      );

      // Step 5: Publish message to RabbitMQ (simulating scheduled job)
      const jobMessage: JobMessage = {
        id: randomUUID(),
        auctionId: auction._id.toString(),
        publishedAt: new Date(),
      };

      await amqpConnection.publish('delayed.ex', 'jobs', jobMessage, {
        headers: {
          'x-delay': 0, // Process immediately
        },
      });

      // Step 6: Wait for message to be processed
      // RabbitMQ consumer will process the message asynchronously
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Step 7: Verify auction was processed
      const finalAuction = await dbHelpers.getAuction(auction._id);
      expect(finalAuction.status).toBe(AuctionStatus.ENDED);

      // Step 8: Verify bids were processed
      const finalBids = await dbHelpers.getBidsByAuction(auction._id);
      const wonBids = finalBids.filter((b) => b.status === BidStatus.WON);
      const lostBids = finalBids.filter((b) => b.status === BidStatus.LOST);

      expect(wonBids).toHaveLength(2); // 2 items
      expect(lostBids).toHaveLength(0); // All active bids won

      // Step 9: Verify seller received payment
      const sellerWallet = await dbHelpers.getWalletByUserId(seller._id);
      expect(sellerWallet.balance).toBe(350); // 150 + 200

      // Step 10: Verify winners' balances
      const wallet1Final = await dbHelpers.getWalletByUserId(bidder1._id);
      const wallet2Final = await dbHelpers.getWalletByUserId(bidder2._id);

      expect(wallet1Final.balance).toBe(850); // 1000 - 150
      expect(wallet1Final.lockedBalance).toBe(0);
      expect(wallet2Final.balance).toBe(800); // 1000 - 200
      expect(wallet2Final.lockedBalance).toBe(0);
    }, 10000); // Increase timeout for RabbitMQ processing

    it('should handle multiple auctions processed concurrently via RabbitMQ', async () => {
      // Create 3 auctions
      const auctions = [];
      const sellers = [];
      for (let i = 0; i < 3; i++) {
        const { seller, auction } = await dbHelpers.createCompleteAuction({
          itemCount: 1,
          sellerBalance: 0,
          auctionSettings: {
            minBid: 50,
            minBidDifference: 10,
            antisniping: 60,
          },
        });
        auctions.push(auction);
        sellers.push(seller);
      }

      // Create bidders
      const bidders = [];
      for (let i = 0; i < 3; i++) {
        const { user, wallet } = await dbHelpers.createUserWithWallet(
          {},
          { balance: 1000 },
        );
        const tokens = generateTestTokens(jwtService, {
          userId: user._id.toString(),
          telegramId: user.telegramId,
        });
        bidders.push({ user, wallet, tokens });
      }

      // Place bids on each auction
      for (let i = 0; i < auctions.length; i++) {
        await request(app.getHttpServer())
          .post('/bids/set_bid')
          .set('Authorization', `Bearer ${bidders[i].tokens.accessToken}`)
          .send({
            auctionId: auctions[i]._id.toString(),
            amount: 100 + i * 50,
          })
          .expect(201);
      }

      // End all auctions
      for (const auction of auctions) {
        await dbHelpers.updateAuctionRoundEndTime(
          auction._id,
          0,
          new Date(Date.now() - 1000),
        );
      }

      // Publish messages to RabbitMQ for all auctions
      const publishPromises = auctions.map((auction) =>
        amqpConnection.publish(
          'delayed.ex',
          'jobs',
          {
            id: randomUUID(),
            auctionId: auction._id.toString(),
            publishedAt: new Date(),
          } as JobMessage,
          { headers: { 'x-delay': 0 } },
        ),
      );

      await Promise.all(publishPromises);

      // Wait for all messages to be processed
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Verify all auctions were processed
      for (let i = 0; i < auctions.length; i++) {
        const finalAuction = await dbHelpers.getAuction(auctions[i]._id);
        expect(finalAuction.status).toBe(AuctionStatus.ENDED);

        const sellerWallet = await dbHelpers.getWalletByUserId(sellers[i]._id);
        expect(sellerWallet.balance).toBe(100 + i * 50);
      }
    }, 15000); // Increased timeout for multiple concurrent processes

    it('should handle delayed message processing with x-delay header', async () => {
      // Create auction
      const { auction } = await dbHelpers.createCompleteAuction({
        itemCount: 1,
        sellerBalance: 0,
        auctionSettings: {
          minBid: 50,
          minBidDifference: 10,
          antisniping: 60,
        },
      });

      // Create bidder and place bid
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

      // End auction
      await dbHelpers.updateAuctionRoundEndTime(
        auction._id,
        0,
        new Date(Date.now() - 1000),
      );

      // Publish message with delay
      const jobMessage: JobMessage = {
        id: randomUUID(),
        auctionId: auction._id.toString(),
        publishedAt: new Date(),
      };

      const delayMs = 1500; // 1.5 seconds delay
      const publishTime = Date.now();

      await amqpConnection.publish('delayed.ex', 'jobs', jobMessage, {
        headers: {
          'x-delay': delayMs,
        },
      });

      // Verify auction is not processed immediately
      await new Promise((resolve) => setTimeout(resolve, 500));
      let auctionStatus = await dbHelpers.getAuction(auction._id);
      expect(auctionStatus.status).toBe(AuctionStatus.ACTIVE); // Still active

      // Wait for delayed processing
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const processTime = Date.now();

      // Verify auction was processed after delay
      auctionStatus = await dbHelpers.getAuction(auction._id);
      expect(auctionStatus.status).toBe(AuctionStatus.ENDED);

      // Verify delay was approximately correct (within reasonable tolerance)
      const actualDelay = processTime - publishTime;
      expect(actualDelay).toBeGreaterThanOrEqual(delayMs);
      expect(actualDelay).toBeLessThan(delayMs + 1500); // Allow 1.5s tolerance for processing
    }, 10000);

    it('should push and pull messages correctly from RabbitMQ queue', async () => {
      // Create 2 auctions
      const { auction: auction1 } = await dbHelpers.createCompleteAuction({
        itemCount: 1,
        sellerBalance: 0,
        auctionSettings: {
          minBid: 50,
          minBidDifference: 10,
          antisniping: 60,
        },
      });

      const { auction: auction2 } = await dbHelpers.createCompleteAuction({
        itemCount: 1,
        sellerBalance: 0,
        auctionSettings: {
          minBid: 50,
          minBidDifference: 10,
          antisniping: 60,
        },
      });

      // End both auctions
      await dbHelpers.updateAuctionRoundEndTime(
        auction1._id,
        0,
        new Date(Date.now() - 1000),
      );
      await dbHelpers.updateAuctionRoundEndTime(
        auction2._id,
        0,
        new Date(Date.now() - 1000),
      );

      // Push messages to queue
      const message1: JobMessage = {
        id: randomUUID(),
        auctionId: auction1._id.toString(),
        publishedAt: new Date(),
      };

      const message2: JobMessage = {
        id: randomUUID(),
        auctionId: auction2._id.toString(),
        publishedAt: new Date(),
      };

      // Push both messages
      await amqpConnection.publish('delayed.ex', 'jobs', message1, {
        headers: { 'x-delay': 0 },
      });

      await amqpConnection.publish('delayed.ex', 'jobs', message2, {
        headers: { 'x-delay': 0 },
      });

      // Wait for consumer to pull and process messages
      await new Promise((resolve) => setTimeout(resolve, 2500));

      // Verify both auctions were processed (messages were pulled and consumed)
      const finalAuction1 = await dbHelpers.getAuction(auction1._id);
      const finalAuction2 = await dbHelpers.getAuction(auction2._id);

      expect(finalAuction1.status).toBe(AuctionStatus.ENDED);
      expect(finalAuction2.status).toBe(AuctionStatus.ENDED);
    }, 10000);

    it('should handle message with non-existent auction gracefully', async () => {
      // Create a message with fake auction ID
      const fakeAuctionId = new Types.ObjectId().toString();
      const jobMessage: JobMessage = {
        id: randomUUID(),
        auctionId: fakeAuctionId,
        publishedAt: new Date(),
      };

      // Push message to queue
      await amqpConnection.publish('delayed.ex', 'jobs', jobMessage, {
        headers: { 'x-delay': 0 },
      });

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Consumer should handle gracefully and not crash
      // Verify the app is still running by making a health check
      const response = await request(app.getHttpServer())
        .get('/healthcheck')
        .expect(200);

      expect(response.body.message).toBe('OK');
    }, 10000);

    it('should handle message for already processed auction', async () => {
      // Create and immediately end auction
      const { auction } = await dbHelpers.createCompleteAuction({
        itemCount: 1,
        sellerBalance: 0,
        auctionSettings: {
          minBid: 50,
          minBidDifference: 10,
          antisniping: 60,
        },
      });

      // End auction
      await dbHelpers.updateAuctionRoundEndTime(
        auction._id,
        0,
        new Date(Date.now() - 1000),
      );

      // Process once
      await auctionProcessor.processAuctionSync(
        createJobMessage(auction._id.toString()),
      );

      // Verify auction is ended
      let auctionStatus = await dbHelpers.getAuction(auction._id);
      expect(auctionStatus.status).toBe(AuctionStatus.ENDED);

      // Push message for already ended auction
      const jobMessage: JobMessage = {
        id: randomUUID(),
        auctionId: auction._id.toString(),
        publishedAt: new Date(),
      };

      await amqpConnection.publish('delayed.ex', 'jobs', jobMessage, {
        headers: { 'x-delay': 0 },
      });

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Verify auction status unchanged
      auctionStatus = await dbHelpers.getAuction(auction._id);
      expect(auctionStatus.status).toBe(AuctionStatus.ENDED);

      // App should still be healthy
      const response = await request(app.getHttpServer())
        .get('/healthcheck')
        .expect(200);

      expect(response.body.message).toBe('OK');
    }, 10000);
  });
});
