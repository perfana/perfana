import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersPermissionsController } from './users-permissions.controller';
import { UsersDbContextController } from './users-db-context.controller';
import { AuthModule } from '../auth/auth.module';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [AuthModule, CommonModule],
  controllers: [UsersController, UsersPermissionsController, UsersDbContextController],
})
export class UsersModule {}
