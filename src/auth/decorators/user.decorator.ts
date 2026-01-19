import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

export interface UserPayload {
  userId: string;
  telegramId: number;
}

export const User = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext): UserPayload | string => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const user = request.user as UserPayload;

    if (data === 'id') {
      return user.userId;
    }

    return user;
  },
);
