import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { ModelsModule } from '../models/models.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [ModelsModule, AuthModule],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
