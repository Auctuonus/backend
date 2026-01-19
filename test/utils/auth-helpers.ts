import { JwtService } from '@nestjs/jwt';
import { Types } from 'mongoose';
import configuration from 'src/config';

export interface TestUser {
  userId: string;
  telegramId: number;
}

export interface TestTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * Creates a test JWT service for generating tokens
 */
export function createTestJwtService(): JwtService {
  const config = configuration();
  return new JwtService({
    secret: config.jwt.secret,
    signOptions: {},
  });
}

/**
 * Generates test tokens for a user
 */
export function generateTestTokens(
  jwtService: JwtService,
  user: TestUser,
): TestTokens {
  const config = configuration();

  const accessPayload = {
    userId: user.userId,
    telegramId: user.telegramId,
    type: 'access' as const,
  };

  const refreshPayload = {
    userId: user.userId,
    telegramId: user.telegramId,
    type: 'refresh' as const,
  };

  const accessToken = jwtService.sign(accessPayload, {
    expiresIn: config.jwt.authExpiresIn,
  });

  const refreshToken = jwtService.sign(refreshPayload, {
    expiresIn: config.jwt.refreshTokenExpiresIn,
  });

  return { accessToken, refreshToken };
}

/**
 * Creates a test user with tokens
 */
export function createTestUserWithTokens(
  jwtService: JwtService,
  telegramId: number = Math.floor(Math.random() * 1000000),
): { user: TestUser; tokens: TestTokens } {
  const userId = new Types.ObjectId().toString();
  const user: TestUser = { userId, telegramId };
  const tokens = generateTestTokens(jwtService, user);
  return { user, tokens };
}

/**
 * Gets authorization header for a test user
 */
export function getAuthHeader(accessToken: string): { Authorization: string } {
  return { Authorization: `Bearer ${accessToken}` };
}
