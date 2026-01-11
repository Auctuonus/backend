import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from '../auth.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private authService: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers.authorization;

    if (!authHeader || typeof authHeader !== 'string') {
      throw new UnauthorizedException('Authorization header is missing');
    }

    const [authType, token] = authHeader.split(' ');
    if (authType !== 'Bearer') {
      throw new UnauthorizedException(
        'Invalid authorization type. Expected "Bearer"',
      );
    }
    if (!token) {
      throw new UnauthorizedException('Token is missing');
    }

    try {
      const payload = this.authService.verifyToken(token, 'access');
      request.user = {
        userId: payload.userId,
        telegramId: payload.telegramId,
      };
      return true;
    } catch (error) {
      throw new UnauthorizedException(
        `Invalid token: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}
