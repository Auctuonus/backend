import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { ModelsModule } from '../models/models.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [ModelsModule, AuthModule],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
