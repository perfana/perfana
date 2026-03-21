import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationChannel, SystemUnderTest } from '@perfana/shared/entities';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([NotificationChannel, SystemUnderTest]),
    CommonModule, // Import for AuthorizationService
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
