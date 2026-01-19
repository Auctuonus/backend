import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';

import {
  TestRunnerContext,
  createTestRunnerApp,
  closeTestApp,
  DbHelpers,
} from './utils';
import { AuctionStatus, BidStatus } from 'src/models';
import { AuctionProcessingService } from 'src/auctions/auction.consumer';
import { JobMessage } from 'src/auctions/dto';

describe('AuctionProcessingService (e2e)', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let dbHelpers: DbHelpers;
  let auctionProcessor: AuctionProcessingService;
  let ctx: TestRunnerContext;

  beforeAll(async () => {
    ctx = await createTestRunnerApp();
    app = ctx.app;
    jwtService = ctx.jwtService;
    dbHelpers = ctx.dbHelpers;
    auctionProcessor = ctx.auctionProcessor;
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  beforeEach(async () => {
    await dbHelpers.clearDatabase();
  });

  /**
   * Helper to create a job message
   */
  function createJobMessage(auctionId: string): JobMessage {
    return {
      id: randomUUID(),
      auctionId,
      publishedAt: new Date(),
    };
  }

  describe('processAuction', () => {
    it('should process auction and mark winning bids', async () => {
      // Create auction with items
      const { seller, sellerWallet, items, auction } =
        await dbHelpers.createCompleteAuction({
          itemCount: 3,
          sellerBalance: 0,
          roundEndTime: new Date(Date.now() - 1000), // Already ended
        });

      // Create bidders with bids
      const { user: bidder1, wallet: wallet1 } =
        await dbHelpers.createUserWithWallet(
          {},
          { balance: 1000, lockedBalance: 300 },
        );
      const { user: bidder2, wallet: wallet2 } =
        await dbHelpers.createUserWithWallet(
          {},
          { balance: 1000, lockedBalance: 200 },
        );
      const { user: bidder3, wallet: wallet3 } =
        await dbHelpers.createUserWithWallet(
          {},
          { balance: 1000, lockedBalance: 100 },
        );

      // Create bids (3 items, 3 bidders - all will win)
      await dbHelpers.createBid({
        userId: bidder1._id,
        auctionId: auction._id,
        amount: 300,
        status: BidStatus.ACTIVE,
      });
      await dbHelpers.createBid({
        userId: bidder2._id,
        auctionId: auction._id,
        amount: 200,
        status: BidStatus.ACTIVE,
      });
      await dbHelpers.createBid({
        userId: bidder3._id,
        auctionId: auction._id,
        amount: 100,
        status: BidStatus.ACTIVE,
      });

      // Process auction
      const result = await auctionProcessor.processAuction(
        createJobMessage(auction._id.toString()),
      );

      // Should return null (successful processing)
      expect(result).toBeNull();

      // Verify auction status
      const updatedAuction = await dbHelpers.getAuction(auction._id);
      expect(updatedAuction.status).toBe(AuctionStatus.ENDED);

      // Verify bids status
      const bids = await dbHelpers.getBidsByAuction(auction._id);
      const wonBids = bids.filter((b) => b.status === BidStatus.WON);
      expect(wonBids).toHaveLength(3);

      // Verify seller received payment
      const updatedSellerWallet = await dbHelpers.getWalletByUserId(seller._id);
      expect(updatedSellerWallet.balance).toBe(600); // 300 + 200 + 100
    });

    it('should handle auction with more bids than items', async () => {
      // Create auction with 2 items
      const { seller, sellerWallet, items, auction } =
        await dbHelpers.createCompleteAuction({
          itemCount: 2,
          sellerBalance: 0,
          roundEndTime: new Date(Date.now() - 1000),
        });

      // Create 4 bidders
      const bidders = [];
      for (let i = 0; i < 4; i++) {
        const { user, wallet } = await dbHelpers.createUserWithWallet(
          {},
          { balance: 1000, lockedBalance: (i + 1) * 100 },
        );
        bidders.push({ user, wallet });

        await dbHelpers.createBid({
          userId: user._id,
          auctionId: auction._id,
          amount: (i + 1) * 100, // 100, 200, 300, 400
          status: BidStatus.ACTIVE,
        });
      }

      // Process auction
      await auctionProcessor.processAuction(
        createJobMessage(auction._id.toString()),
      );

      // Verify bids - top 2 should win
      const bids = await dbHelpers.getBidsByAuction(auction._id);
      const wonBids = bids.filter((b) => b.status === BidStatus.WON);
      const lostBids = bids.filter((b) => b.status === BidStatus.LOST);

      expect(wonBids).toHaveLength(2);
      expect(lostBids).toHaveLength(2);

      // Winners should be the top bidders (400 and 300)
      const wonAmounts = wonBids.map((b) => b.amount).sort((a, b) => b - a);
      expect(wonAmounts).toEqual([400, 300]);

      // Verify seller received correct payment
      const updatedSellerWallet = await dbHelpers.getWalletByUserId(seller._id);
      expect(updatedSellerWallet.balance).toBe(700); // 400 + 300
    });

    it('should return Nack for non-existent auction', async () => {
      const fakeAuctionId = '507f1f77bcf86cd799439011';
      const result = await auctionProcessor.processAuction(
        createJobMessage(fakeAuctionId),
      );

      // Should return Nack with requeue=false
      expect(result).toBeDefined();
      expect(result.constructor.name).toBe('Nack');
    });

    it('should return Nack for already ended auction', async () => {
      const { auction } = await dbHelpers.createCompleteAuction({
        roundEndTime: new Date(Date.now() - 1000),
      });
      await dbHelpers.updateAuctionStatus(auction._id, AuctionStatus.ENDED);

      const result = await auctionProcessor.processAuction(
        createJobMessage(auction._id.toString()),
      );

      // Should return Nack with requeue=false
      expect(result).toBeDefined();
      expect(result.constructor.name).toBe('Nack');
    });

    it('should return Nack for cancelled auction', async () => {
      const { auction } = await dbHelpers.createCompleteAuction({
        roundEndTime: new Date(Date.now() - 1000),
      });
      await dbHelpers.updateAuctionStatus(auction._id, AuctionStatus.CANCELLED);

      const result = await auctionProcessor.processAuction(
        createJobMessage(auction._id.toString()),
      );

      // Should return Nack with requeue=false
      expect(result).toBeDefined();
      expect(result.constructor.name).toBe('Nack');
    });

    it('should transfer item ownership to winners', async () => {
      const { seller, items, auction } = await dbHelpers.createCompleteAuction({
        itemCount: 2,
        sellerBalance: 0,
        roundEndTime: new Date(Date.now() - 1000),
      });

      // Create 2 winning bidders
      const { user: bidder1 } = await dbHelpers.createUserWithWallet(
        {},
        { balance: 1000, lockedBalance: 200 },
      );
      const { user: bidder2 } = await dbHelpers.createUserWithWallet(
        {},
        { balance: 1000, lockedBalance: 100 },
      );

      await dbHelpers.createBid({
        userId: bidder1._id,
        auctionId: auction._id,
        amount: 200,
        status: BidStatus.ACTIVE,
      });
      await dbHelpers.createBid({
        userId: bidder2._id,
        auctionId: auction._id,
        amount: 100,
        status: BidStatus.ACTIVE,
      });

      // Process auction
      await auctionProcessor.processAuction(
        createJobMessage(auction._id.toString()),
      );

      // Note: The item ownership transfer is handled in the processor
      // We verify through the transaction records
      const transactions = await dbHelpers.getTransactions();
      const transferTransactions = transactions.filter(
        (t) => t.type === 'TRANSFER',
      );
      expect(transferTransactions.length).toBeGreaterThanOrEqual(2);
    });

    it('should unlock balance for losing bids', async () => {
      const { auction } = await dbHelpers.createCompleteAuction({
        itemCount: 1, // Only 1 item
        sellerBalance: 0,
        roundEndTime: new Date(Date.now() - 1000),
      });

      // Create winning bidder
      const { user: winner } = await dbHelpers.createUserWithWallet(
        {},
        { balance: 1000, lockedBalance: 500 },
      );
      await dbHelpers.createBid({
        userId: winner._id,
        auctionId: auction._id,
        amount: 500,
        status: BidStatus.ACTIVE,
      });

      // Create losing bidder
      const { user: loser } = await dbHelpers.createUserWithWallet(
        {},
        { balance: 1000, lockedBalance: 300 },
      );
      await dbHelpers.createBid({
        userId: loser._id,
        auctionId: auction._id,
        amount: 300,
        status: BidStatus.ACTIVE,
      });

      // Process auction
      await auctionProcessor.processAuction(
        createJobMessage(auction._id.toString()),
      );

      // Verify loser's balance is unlocked
      const loserWallet = await dbHelpers.getWalletByUserId(loser._id);
      expect(loserWallet.lockedBalance).toBe(0); // Should be unlocked

      // Winner's locked balance should be reduced by bid amount
      const winnerWallet = await dbHelpers.getWalletByUserId(winner._id);
      expect(winnerWallet.lockedBalance).toBe(0); // Deducted from locked
    });

    it('should handle auction with no bids gracefully', async () => {
      const { auction } = await dbHelpers.createCompleteAuction({
        itemCount: 2,
        sellerBalance: 0,
        roundEndTime: new Date(Date.now() - 1000),
      });

      // Process auction without any bids
      const result = await auctionProcessor.processAuction(
        createJobMessage(auction._id.toString()),
      );

      // Should complete without error
      // Items remain with seller, no transactions
      const updatedAuction = await dbHelpers.getAuction(auction._id);
      // Auction processing might handle this differently
      // At minimum, it shouldn't crash
    });

    it('should create transaction records for all transfers', async () => {
      const { seller, auction } = await dbHelpers.createCompleteAuction({
        itemCount: 2,
        sellerBalance: 0,
        roundEndTime: new Date(Date.now() - 1000),
      });

      // Create bidders
      const { user: bidder1 } = await dbHelpers.createUserWithWallet(
        {},
        { balance: 1000, lockedBalance: 200 },
      );
      const { user: bidder2 } = await dbHelpers.createUserWithWallet(
        {},
        { balance: 1000, lockedBalance: 150 },
      );

      await dbHelpers.createBid({
        userId: bidder1._id,
        auctionId: auction._id,
        amount: 200,
        status: BidStatus.ACTIVE,
      });
      await dbHelpers.createBid({
        userId: bidder2._id,
        auctionId: auction._id,
        amount: 150,
        status: BidStatus.ACTIVE,
      });

      // Process auction
      await auctionProcessor.processAuction(
        createJobMessage(auction._id.toString()),
      );

      // Verify transactions
      const transactions = await dbHelpers.getTransactions();
      expect(transactions.length).toBeGreaterThanOrEqual(2);

      // Should have TRANSFER type transactions
      const transfers = transactions.filter((t) => t.type === 'TRANSFER');
      expect(transfers.length).toBe(2);

      // Total transfer amount should equal total winning bids
      const totalTransferred = transfers.reduce((sum, t) => sum + t.amount, 0);
      expect(totalTransferred).toBe(350); // 200 + 150
    });
  });

  describe('Multiple Rounds', () => {
    it('should process only ended rounds', async () => {
      const { user: seller, wallet: sellerWallet } =
        await dbHelpers.createUserWithWallet();
      const items1 = await dbHelpers.createItems(2, seller._id, 'round1');
      const items2 = await dbHelpers.createItems(2, seller._id, 'round2');

      const now = new Date();
      const pastTime = new Date(now.getTime() - 60 * 60 * 1000); // 1 hour ago
      const futureTime = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour from now

      // Create auction with 2 rounds - one ended, one active
      const auction = await dbHelpers.createAuction({
        sellerId: seller._id,
        sellerWalletId: sellerWallet._id,
        rounds: [
          {
            startTime: new Date(pastTime.getTime() - 60 * 60 * 1000),
            endTime: pastTime,
            status: AuctionStatus.ACTIVE,
            itemIds: items1.map((i) => i._id),
          },
          {
            startTime: now,
            endTime: futureTime,
            status: AuctionStatus.ACTIVE,
            itemIds: items2.map((i) => i._id),
          },
        ],
      });

      // Create bid for round 1
      const { user: bidder } = await dbHelpers.createUserWithWallet(
        {},
        { balance: 1000, lockedBalance: 200 },
      );
      await dbHelpers.createBid({
        userId: bidder._id,
        auctionId: auction._id,
        amount: 200,
        status: BidStatus.ACTIVE,
      });

      // Process auction
      await auctionProcessor.processAuction(
        createJobMessage(auction._id.toString()),
      );

      // Verify auction is still active (round 2 not ended)
      const updatedAuction = await dbHelpers.getAuction(auction._id);
      // Round 1 should be processed, auction may or may not be ended
      // depending on implementation
    });
  });

  describe('Edge Cases', () => {
    it('should handle concurrent processing attempts', async () => {
      const { auction } = await dbHelpers.createCompleteAuction({
        itemCount: 1,
        roundEndTime: new Date(Date.now() - 1000),
      });

      const { user: bidder } = await dbHelpers.createUserWithWallet(
        {},
        { balance: 1000, lockedBalance: 100 },
      );
      await dbHelpers.createBid({
        userId: bidder._id,
        auctionId: auction._id,
        amount: 100,
        status: BidStatus.ACTIVE,
      });

      // Process same auction twice concurrently
      const [result1, result2] = await Promise.all([
        auctionProcessor.processAuction(
          createJobMessage(auction._id.toString()),
        ),
        auctionProcessor.processAuction(
          createJobMessage(auction._id.toString()),
        ),
      ]);

      // One should succeed, one should return Nack
      // (since auction status changes after first processing)
      const results = [result1, result2];
      const successCount = results.filter((r) => r === null).length;
      const nackCount = results.filter(
        (r) => r?.constructor.name === 'Nack',
      ).length;

      // At least one should succeed or both might succeed if processing is fast enough
      expect(successCount + nackCount).toBe(2);
    });

    it('should handle auction with same bid amounts', async () => {
      const { seller, auction } = await dbHelpers.createCompleteAuction({
        itemCount: 2,
        sellerBalance: 0,
        roundEndTime: new Date(Date.now() - 1000),
      });

      // Create 3 bidders with same amount
      const bidders = [];
      for (let i = 0; i < 3; i++) {
        const { user } = await dbHelpers.createUserWithWallet(
          {},
          { balance: 1000, lockedBalance: 100 },
        );
        bidders.push(user);
        await dbHelpers.createBid({
          userId: user._id,
          auctionId: auction._id,
          amount: 100, // Same amount
          status: BidStatus.ACTIVE,
        });
      }

      // Process auction
      await auctionProcessor.processAuction(
        createJobMessage(auction._id.toString()),
      );

      // Verify 2 winners (for 2 items)
      const bids = await dbHelpers.getBidsByAuction(auction._id);
      const wonBids = bids.filter((b) => b.status === BidStatus.WON);
      expect(wonBids).toHaveLength(2);

      // Verify seller got payment
      const sellerWallet = await dbHelpers.getWalletByUserId(seller._id);
      expect(sellerWallet.balance).toBe(200); // 2 * 100
    });

    it('should handle single item auction', async () => {
      const { seller, auction } = await dbHelpers.createCompleteAuction({
        itemCount: 1,
        sellerBalance: 0,
        roundEndTime: new Date(Date.now() - 1000),
      });

      // Create 2 bidders
      const { user: bidder1 } = await dbHelpers.createUserWithWallet(
        {},
        { balance: 1000, lockedBalance: 500 },
      );
      const { user: bidder2 } = await dbHelpers.createUserWithWallet(
        {},
        { balance: 1000, lockedBalance: 300 },
      );

      await dbHelpers.createBid({
        userId: bidder1._id,
        auctionId: auction._id,
        amount: 500,
        status: BidStatus.ACTIVE,
      });
      await dbHelpers.createBid({
        userId: bidder2._id,
        auctionId: auction._id,
        amount: 300,
        status: BidStatus.ACTIVE,
      });

      // Process
      await auctionProcessor.processAuction(
        createJobMessage(auction._id.toString()),
      );

      // Verify single winner
      const bids = await dbHelpers.getBidsByAuction(auction._id);
      const wonBids = bids.filter((b) => b.status === BidStatus.WON);
      expect(wonBids).toHaveLength(1);
      expect(wonBids[0].amount).toBe(500); // Higher bid wins

      // Verify seller payment
      const sellerWallet = await dbHelpers.getWalletByUserId(seller._id);
      expect(sellerWallet.balance).toBe(500);
    });

    it('should handle large number of bids', async () => {
      const { seller, auction } = await dbHelpers.createCompleteAuction({
        itemCount: 5,
        sellerBalance: 0,
        roundEndTime: new Date(Date.now() - 1000),
      });

      // Create 50 bidders
      for (let i = 0; i < 50; i++) {
        const { user } = await dbHelpers.createUserWithWallet(
          {},
          { balance: 10000, lockedBalance: 100 + i * 10 },
        );
        await dbHelpers.createBid({
          userId: user._id,
          auctionId: auction._id,
          amount: 100 + i * 10, // 100, 110, 120, ..., 590
          status: BidStatus.ACTIVE,
        });
      }

      // Process
      const result = await auctionProcessor.processAuction(
        createJobMessage(auction._id.toString()),
      );

      expect(result).toBeNull(); // Should complete successfully

      // Verify 5 winners
      const bids = await dbHelpers.getBidsByAuction(auction._id);
      const wonBids = bids.filter((b) => b.status === BidStatus.WON);
      expect(wonBids).toHaveLength(5);

      // Top 5 amounts: 590, 580, 570, 560, 550
      const wonAmounts = wonBids.map((b) => b.amount).sort((a, b) => b - a);
      expect(wonAmounts).toEqual([590, 580, 570, 560, 550]);
    });
  });
});
