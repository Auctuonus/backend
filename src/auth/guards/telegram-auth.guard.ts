import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { validate, parse } from '@tma.js/init-data-node';
import type { InitData } from '@tma.js/init-data-node';
import configuration from '../../config';

@Injectable()
export class TelegramAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    // Fake init data for development/testing
    request.initData = {
      auth_date: new Date(),
      hash: 'fake_hash_for_development_' + Date.now(),
      signature: 'fake_signature_for_development',
      user: {
        id: 336619540,
        first_name: 'John',
        last_name: 'Doe',
        username: 'johndoe',
        language_code: 'en',
        is_premium: false,
        allows_write_to_pm: true,
      },
      query_id: 'fake_query_id_' + Date.now(),
      chat_type: 'sender',
      start_param: 'test',
    } as InitData;
    return true;
  }

  _canActivate(context: ExecutionContext): boolean {
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
