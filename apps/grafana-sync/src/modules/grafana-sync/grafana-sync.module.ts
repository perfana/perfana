import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GrafanaSyncService } from './grafana-sync.service';
import { StoreDashboardService } from './store-dashboard.service';
import { RestoreDashboardService } from './restore-dashboard.service';
import { UpdateDashboardsService } from './update-dashboards.service';
import { GrafanaApiModule } from '../grafana-api/grafana-api.module';
import { GrafanaDashboard, GrafanaInstance, ApplicationDashboard } from '@perfana/shared/entities';

/**
 * GrafanaSyncModule
 *
 * Main orchestration module for synchronizing dashboards between Grafana instances
 * and the Perfana database. Handles:
 * - Storing new dashboards from Grafana
 * - Restoring missing dashboards to Grafana
 * - Updating existing dashboards with changes
 */
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
