import { Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';
import { AuthModule } from '../auth/auth.module';
import { TestRunsModule } from '../test-runs/test-runs.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [AuthModule, TestRunsModule, NotificationsModule],
  providers: [RealtimeGateway, RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}