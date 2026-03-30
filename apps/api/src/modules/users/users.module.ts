import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { AuthModule } from '../auth/auth.module';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [AuthModule, CommonModule],
  controllers: [UsersController],
})
export class UsersModule {}
