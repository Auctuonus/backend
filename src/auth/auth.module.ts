import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { ModelsModule } from '../models/models.module';
import configuration from '../config';

const config = configuration();

@Module({
  imports: [
    ModelsModule,
    JwtModule.register({
      global: true,
      secret: config.jwt.secret,
    }),
  ],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
