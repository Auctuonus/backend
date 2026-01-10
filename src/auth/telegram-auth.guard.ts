import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { validate, parse } from '@tma.js/init-data-node';
import type { InitData } from '@tma.js/init-data-node';
import configuration from '../config';

@Injectable()
export class TelegramAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers.authorization;

    if (!authHeader || typeof authHeader !== 'string') {
      throw new UnauthorizedException('Authorization header is missing');
    }

    const [authType, authData] = authHeader.split(' ');
    if (authType !== 'tma') {
      throw new UnauthorizedException(
        'Invalid authorization type. Expected "tma"',
      );
    }
    if (!authData) {
      throw new UnauthorizedException('Init data is missing');
    }

    const config = configuration();
    try {
      validate(authData, config.telegramBotToken, {
        expiresIn: 3600,
      });

      // Parse init data and attach it to the request
      const initData: InitData = parse(authData);
      request.initData = initData;

      return true;
    } catch (error) {
      throw new UnauthorizedException(
        `Invalid init data: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}
