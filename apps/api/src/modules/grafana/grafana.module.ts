import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GrafanaInstancesController } from './grafana-instances.controller';
import { GrafanaInstancesService } from './grafana-instances.service';
import { GrafanaDashboardsController } from './grafana-dashboards.controller';
import { GrafanaDashboardsService } from './grafana-dashboards.service';
import { GrafanaClientService } from './grafana-client.service';
import { ApplicationDashboardsController } from './application-dashboards.controller';
import { ApplicationDashboardsService } from './application-dashboards.service';
import { ApplicationDashboard, GrafanaInstance, GrafanaDashboard, SystemUnderTest } from '../../entities';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ApplicationDashboard, GrafanaInstance, GrafanaDashboard, SystemUnderTest]),
    CommonModule, // Import for AuthorizationService
  ],
  controllers: [
    GrafanaInstancesController,
    GrafanaDashboardsController,
    ApplicationDashboardsController
  ],
  providers: [
    GrafanaInstancesService,
    GrafanaDashboardsService,
    GrafanaClientService,
    ApplicationDashboardsService
  ],
  exports: [
    GrafanaInstancesService,
    GrafanaDashboardsService,
    GrafanaClientService,
    ApplicationDashboardsService
  ],
})
export class GrafanaModule {}