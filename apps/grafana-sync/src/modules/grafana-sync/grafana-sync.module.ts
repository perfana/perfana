import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GrafanaSyncService } from './grafana-sync.service';
import { StoreDashboardService } from './store-dashboard.service';
import { RestoreDashboardService } from './restore-dashboard.service';
import { UpdateDashboardsService } from './update-dashboards.service';
import { GrafanaApiModule } from '../grafana-api/grafana-api.module';
import { GrafanaDashboard, GrafanaInstance, ApplicationDashboard } from '@perfana/shared/entities';

@Module({
  imports: [
    TypeOrmModule.forFeature([GrafanaDashboard, GrafanaInstance, ApplicationDashboard]),
    GrafanaApiModule,
  ],
  providers: [
    GrafanaSyncService,
    StoreDashboardService,
    RestoreDashboardService,
    UpdateDashboardsService,
  ],
  exports: [GrafanaSyncService],
})
export class GrafanaSyncModule {}
