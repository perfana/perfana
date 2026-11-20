import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationChannel, SystemUnderTest } from '@perfana/shared/entities';
import { NotificationsController } from './notifications.controller';
import { CommentNotificationScheduler } from './comment-notification-scheduler.service';
import { NotificationsService } from './notifications.service';
import { CommonModule } from '../../common/common.module';
import { ProxyModule } from '../proxy/proxy.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([NotificationChannel, SystemUnderTest]),
    CommonModule, // Import for AuthorizationService
    ProxyModule,  // Provides ProxyResolverService for outbound proxy routing
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, CommentNotificationScheduler],
  exports: [NotificationsService],
})
export class NotificationsModule {}
