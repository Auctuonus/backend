import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import {
  MongooseModule,
  getConnectionToken,
  getModelToken,
} from '@nestjs/mongoose';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { CacheModule } from '@nestjs/cache-manager';
import { Connection, Model } from 'mongoose';
import { RabbitMQModule, AmqpConnection } from '@golevelup/nestjs-rabbitmq';

import { ModelsModule } from 'src/models/models.module';
import { AuthModule } from 'src/auth/auth.module';
import { AuctionModule } from 'src/auctions/auction.module';
import { BidModule } from 'src/bids/bid.module';
import { UserModule } from 'src/users/user.module';

import { AuthController } from 'src/auth/auth.controller';
import { UserController } from 'src/users/user.controller';
import { AuctionController } from 'src/auctions/auction.controller';
import { BidController } from 'src/bids/bid.controller';
import { HealthcheckController } from 'src/utils/healthcheck.controller';

import { AuctionProcessingService } from 'src/auctions/auction.consumer';
import { DistributedLockService } from 'src/redis/distributed-lock.service';
import { MockDistributedLockService } from 'src/redis/distributed-lock.service.mock';

import {
  User,
  UserDocument,
  Wallet,
  WalletDocument,
  Auction,
  AuctionDocument,
  Item,
  ItemDocument,
  Bid,
  BidDocument,
  Transaction,
  TransactionDocument,
} from 'src/models';

import configuration from 'src/config';
import { DbHelpers } from './db-helpers';

export interface TestAppContext {
  app: INestApplication;
  module: TestingModule;
  jwtService: JwtService;
  dbHelpers: DbHelpers;
  connection: Connection;
}

export interface TestRunnerContext extends TestAppContext {
  auctionProcessor: AuctionProcessingService;
  amqpConnection?: AmqpConnection;
}

/**
 * Creates a test web application (similar to AppModule)
 */
export async function createTestWebApp(): Promise<TestAppContext> {
  const config = configuration();

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [
      MongooseModule.forRoot(config.mongodbUrl),
      CacheModule.register({
        isGlobal: true,
        ttl: 0, // Disable caching for tests
      }),
      JwtModule.register({
        global: true,
        secret: config.jwt.secret,
      }),
      ModelsModule,
      AuthModule,
      AuctionModule,
      BidModule,
      UserModule,
    ],
    controllers: [
      AuthController,
      UserController,
      AuctionController,
      BidController,
      HealthcheckController,
    ],
  }).overrideProvider(DistributedLockService)
    .useClass(MockDistributedLockService)
    .compile();

  const app = moduleFixture.createNestApplication();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.init();

  const connection = moduleFixture.get<Connection>(getConnectionToken());
  const jwtService = moduleFixture.get<JwtService>(JwtService);

  const dbHelpers = new DbHelpers(
    moduleFixture.get<Model<UserDocument>>(getModelToken(User.name)),
    moduleFixture.get<Model<WalletDocument>>(getModelToken(Wallet.name)),
    moduleFixture.get<Model<AuctionDocument>>(getModelToken(Auction.name)),
    moduleFixture.get<Model<ItemDocument>>(getModelToken(Item.name)),
    moduleFixture.get<Model<BidDocument>>(getModelToken(Bid.name)),
    moduleFixture.get<Model<TransactionDocument>>(
      getModelToken(Transaction.name),
    ),
    connection,
  );

  return {
    app,
    module: moduleFixture,
    jwtService,
    dbHelpers,
    connection,
  };
}

/**
 * Creates a test runner application (similar to RunnerModule)
 * Does not connect to RabbitMQ - uses direct method calls for testing
 */
export async function createTestRunnerApp(): Promise<TestRunnerContext> {
  const config = configuration();

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [
      MongooseModule.forRoot(config.mongodbUrl),
      CacheModule.register({
        isGlobal: true,
        ttl: 0,
      }),
      JwtModule.register({
        global: true,
        secret: config.jwt.secret,
      }),
      ModelsModule,
      AuthModule,
      AuctionModule,
      BidModule,
      UserModule,
    ],
    controllers: [HealthcheckController],
    providers: [
      AuctionProcessingService,
      {
        provide: DistributedLockService,
        useClass: MockDistributedLockService,
      },
    ],
  }).compile();

  const app = moduleFixture.createNestApplication();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.init();

  const connection = moduleFixture.get<Connection>(getConnectionToken());
  const jwtService = moduleFixture.get<JwtService>(JwtService);
  const auctionProcessor = moduleFixture.get<AuctionProcessingService>(
    AuctionProcessingService,
  );

  const dbHelpers = new DbHelpers(
    moduleFixture.get<Model<UserDocument>>(getModelToken(User.name)),
    moduleFixture.get<Model<WalletDocument>>(getModelToken(Wallet.name)),
    moduleFixture.get<Model<AuctionDocument>>(getModelToken(Auction.name)),
    moduleFixture.get<Model<ItemDocument>>(getModelToken(Item.name)),
    moduleFixture.get<Model<BidDocument>>(getModelToken(Bid.name)),
    moduleFixture.get<Model<TransactionDocument>>(
      getModelToken(Transaction.name),
    ),
    connection,
  );

  return {
    app,
    module: moduleFixture,
    jwtService,
    dbHelpers,
    connection,
    auctionProcessor,
  };
}

/**
 * Creates a combined test app with both web and runner functionality
 * Includes RabbitMQ for full integration testing
 */
export async function createFullTestApp(): Promise<TestRunnerContext> {
  const config = configuration();

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [
      MongooseModule.forRoot(config.mongodbUrl),
      RabbitMQModule.forRoot(config.rabbitmq),
      CacheModule.register({
        isGlobal: true,
        ttl: 0,
      }),
      JwtModule.register({
        global: true,
        secret: config.jwt.secret,
      }),
      ModelsModule,
      AuthModule,
      AuctionModule,
      BidModule,
      UserModule,
    ],
    controllers: [
      AuthController,
      UserController,
      AuctionController,
      BidController,
      HealthcheckController,
    ],
    providers: [
      AuctionProcessingService,
      {
        provide: DistributedLockService,
        useClass: MockDistributedLockService,
      },
    ],
  }).compile();

  const app = moduleFixture.createNestApplication();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.init();

  const connection = moduleFixture.get<Connection>(getConnectionToken());
  const jwtService = moduleFixture.get<JwtService>(JwtService);
  const auctionProcessor = moduleFixture.get<AuctionProcessingService>(
    AuctionProcessingService,
  );
  const amqpConnection = moduleFixture.get<AmqpConnection>(AmqpConnection);

  const dbHelpers = new DbHelpers(
    moduleFixture.get<Model<UserDocument>>(getModelToken(User.name)),
    moduleFixture.get<Model<WalletDocument>>(getModelToken(Wallet.name)),
    moduleFixture.get<Model<AuctionDocument>>(getModelToken(Auction.name)),
    moduleFixture.get<Model<ItemDocument>>(getModelToken(Item.name)),
    moduleFixture.get<Model<BidDocument>>(getModelToken(Bid.name)),
    moduleFixture.get<Model<TransactionDocument>>(
      getModelToken(Transaction.name),
    ),
    connection,
  );

  return {
    app,
    module: moduleFixture,
    jwtService,
    dbHelpers,
    connection,
    auctionProcessor,
    amqpConnection,
  };
}

/**
 * Closes a test application cleanly
 */
export async function closeTestApp(context: TestAppContext): Promise<void> {
  await context.connection.close();
  await context.app.close();
}
