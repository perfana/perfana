import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Event, SystemUnderTest, ApplicationDashboard, GrafanaInstance } from '../../entities';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { CommonModule } from '../../common/common.module';
import { GrafanaModule } from '../grafana/grafana.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Event, SystemUnderTest, ApplicationDashboard, GrafanaInstance]),
    CommonModule,
    GrafanaModule,
  ],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
