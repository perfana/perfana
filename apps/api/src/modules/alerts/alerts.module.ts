import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TestRun, SystemUnderTest, AlertTagFilter } from '../../entities';
import { AlertsWebhookController } from './alerts-webhook.controller';
import { AlertTagFiltersController } from './alert-tag-filters.controller';
import { AlertsService } from './alerts.service';
import { AlertTagFiltersService } from './alert-tag-filters.service';
import { CommonModule } from '../../common/common.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TestRun, SystemUnderTest, AlertTagFilter]),
    CommonModule,
    EventsModule,
  ],
  controllers: [AlertsWebhookController, AlertTagFiltersController],
  providers: [AlertsService, AlertTagFiltersService],
  exports: [AlertsService],
})
export class AlertsModule {}
