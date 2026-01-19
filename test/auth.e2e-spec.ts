import * as request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import {
  TestAppContext,
  createTestWebApp,
  closeTestApp,
  DbHelpers,
  generateTestTokens,
} from './utils';

describe('AuthController (e2e)', () => {
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

  describe('POST /auth/password', () => {
    it('should login existing user with correct password', async () => {
      const telegramId = 123456789;
      const password = 'testPassword123';
      const hashedPassword = await bcrypt.hash(password, 10);

      await dbHelpers.createUser({ telegramId, hashedPassword });

      const response = await request(app.getHttpServer())
        .post('/auth/password')
        .send({ telegramId, password })
        .expect(201);

      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');

      // Verify tokens are valid
      const decodedAccess = jwtService.decode(response.body.accessToken);
      expect(decodedAccess).toHaveProperty('telegramId', telegramId);
      expect(decodedAccess).toHaveProperty('type', 'access');
    });

    it('should set password for first-time user login', async () => {
      const telegramId = 987654321;
      const password = 'newPassword456';

      // Create user without password
      await dbHelpers.createUser({ telegramId });

      // First login should set the password
      const response = await request(app.getHttpServer())
        .post('/auth/password')
        .send({ telegramId, password })
        .expect(201);

      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');

      // Second login with same password should work
      const response2 = await request(app.getHttpServer())
        .post('/auth/password')
        .send({ telegramId, password })
        .expect(201);

      expect(response2.body).toHaveProperty('accessToken');
    });

    it('should reject wrong password', async () => {
      const telegramId = 111222333;
      const password = 'correctPassword';
      const hashedPassword = await bcrypt.hash(password, 10);

      await dbHelpers.createUser({ telegramId, hashedPassword });

      await request(app.getHttpServer())
        .post('/auth/password')
        .send({ telegramId, password: 'wrongPassword' })
        .expect(401);
    });

    it('should reject non-existent user', async () => {
      await request(app.getHttpServer())
        .post('/auth/password')
        .send({ telegramId: 999999999, password: 'anyPassword' })
        .expect(401);
    });
  });

  describe('POST /auth/refresh', () => {
    it('should issue new tokens with valid refresh token', async () => {
      const { user } = await dbHelpers.createUserWithWallet();
      const tokens = generateTestTokens(jwtService, {
        userId: user._id.toString(),
        telegramId: user.telegramId,
      });

      // Add small delay to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const response = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: tokens.refreshToken })
        .expect(201);

      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');

      // Tokens should be valid JWT format
      expect(typeof response.body.accessToken).toBe('string');
      expect(typeof response.body.refreshToken).toBe('string');
      expect(response.body.accessToken.split('.')).toHaveLength(3);
      expect(response.body.refreshToken.split('.')).toHaveLength(3);
    });

    it('should reject expired refresh token', async () => {
      const { user } = await dbHelpers.createUserWithWallet();

      // Create expired token
      const expiredToken = jwtService.sign(
        {
          userId: user._id.toString(),
          telegramId: user.telegramId,
          type: 'refresh',
        },
        { expiresIn: '-1s' },
      );

      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: expiredToken })
        .expect(401);
    });

    it('should reject access token used as refresh token', async () => {
      const { user } = await dbHelpers.createUserWithWallet();
      const tokens = generateTestTokens(jwtService, {
        userId: user._id.toString(),
        telegramId: user.telegramId,
      });

      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: tokens.accessToken })
        .expect(401);
    });

    it('should reject invalid refresh token', async () => {
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: 'invalid-token' })
        .expect(401);
    });

    it('should reject missing refresh token', async () => {
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({})
        .expect(400);
    });
  });

  describe('Token Verification', () => {
    it('should verify valid access token structure', async () => {
      const { user } = await dbHelpers.createUserWithWallet();
      const tokens = generateTestTokens(jwtService, {
        userId: user._id.toString(),
        telegramId: user.telegramId,
      });

      const decoded = jwtService.decode(tokens.accessToken) as Record<
        string,
        unknown
      >;
      expect(decoded).toHaveProperty('userId', user._id.toString());
      expect(decoded).toHaveProperty('telegramId', user.telegramId);
      expect(decoded).toHaveProperty('type', 'access');
      expect(decoded).toHaveProperty('iat');
      expect(decoded).toHaveProperty('exp');
    });

    it('should verify valid refresh token structure', async () => {
      const { user } = await dbHelpers.createUserWithWallet();
      const tokens = generateTestTokens(jwtService, {
        userId: user._id.toString(),
        telegramId: user.telegramId,
      });

      const decoded = jwtService.decode(tokens.refreshToken) as Record<
        string,
        unknown
      >;
      expect(decoded).toHaveProperty('userId', user._id.toString());
      expect(decoded).toHaveProperty('telegramId', user.telegramId);
      expect(decoded).toHaveProperty('type', 'refresh');
      expect(decoded).toHaveProperty('iat');
      expect(decoded).toHaveProperty('exp');
    });

    it('should have longer expiration for refresh token than access token', async () => {
      const { user } = await dbHelpers.createUserWithWallet();
      const tokens = generateTestTokens(jwtService, {
        userId: user._id.toString(),
        telegramId: user.telegramId,
      });

      const accessDecoded = jwtService.decode(tokens.accessToken) as Record<
        string,
        number
      >;
      const refreshDecoded = jwtService.decode(tokens.refreshToken) as Record<
        string,
        number
      >;

      const accessExpiry = accessDecoded.exp - accessDecoded.iat;
      const refreshExpiry = refreshDecoded.exp - refreshDecoded.iat;

      expect(refreshExpiry).toBeGreaterThan(accessExpiry);
    });
  });

  describe('Protected Endpoints', () => {
    it('should access protected endpoint with valid token', async () => {
      const { user } = await dbHelpers.createUserWithWallet();
      const tokens = generateTestTokens(jwtService, {
        userId: user._id.toString(),
        telegramId: user.telegramId,
      });

      // Access a protected endpoint
      await request(app.getHttpServer())
        .post('/auctions/get_list')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ pagination: { page: 1, pageSize: 10 } })
        .expect(201);
    });

    it('should reject protected endpoint without token', async () => {
      await request(app.getHttpServer())
        .post('/auctions/get_list')
        .send({ pagination: { page: 1, pageSize: 10 } })
        .expect(401);
    });

    it('should reject protected endpoint with malformed header', async () => {
      const { user } = await dbHelpers.createUserWithWallet();
      const tokens = generateTestTokens(jwtService, {
        userId: user._id.toString(),
        telegramId: user.telegramId,
      });

      // Missing Bearer prefix
      await request(app.getHttpServer())
        .post('/auctions/get_list')
        .set('Authorization', tokens.accessToken)
        .send({ pagination: { page: 1, pageSize: 10 } })
        .expect(401);

      // Wrong prefix
      await request(app.getHttpServer())
        .post('/auctions/get_list')
        .set('Authorization', `Basic ${tokens.accessToken}`)
        .send({ pagination: { page: 1, pageSize: 10 } })
        .expect(401);
    });
  });
});
