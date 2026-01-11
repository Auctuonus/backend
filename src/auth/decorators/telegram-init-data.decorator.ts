import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import type { InitData } from '@tma.js/init-data-node';

/**
 * Decorator to extract Telegram init data from the request.
 * Must be used with TelegramAuthGuard.
 *
 * @example
 * ```typescript
 * @Get('profile')
 * @UseGuards(TelegramAuthGuard)
 * async getProfile(@TelegramInitData() initData: InitData) {
 *   return { user: initData.user };
 * }
 * ```
 */
export const TelegramInitData = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): InitData => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.initData;
  },
);
