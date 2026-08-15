import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GrafanaInstancesController } from './grafana-instances.controller';
import { GrafanaInstancesService } from './grafana-instances.service';
import { GrafanaDashboardsController } from './grafana-dashboards.controller';
import { GrafanaDashboardsService } from './grafana-dashboards.service';
import { GrafanaClientService } from './grafana-client.service';
import { ApplicationDashboardsController } from './application-dashboards.controller';
import { ApplicationDashboardsService } from './application-dashboards.service';
import { ApplicationDashboardDeletionProcessor } from './processors/application-dashboard-deletion.processor';
import { ApplicationDashboard, GrafanaInstance, GrafanaDashboard, SystemUnderTest } from '../../entities';
import { CommonModule } from '../../common/common.module';
import { AuditModule } from '../audit/audit.module';
import { AuditResourceRegistry } from '../audit/audit-resource-registry';
import { ProxyModule } from '../proxy/proxy.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ApplicationDashboard, GrafanaInstance, GrafanaDashboard, SystemUnderTest]),
    CommonModule, // Import for AuthorizationService
    AuditModule, // Phase 5a: provides AuditService + AuditResourceRegistry
    ProxyModule,  // Provides ProxyResolverService for outbound proxy routing
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
    ApplicationDashboardsService,
    ApplicationDashboardDeletionProcessor
  ],
  exports: [
    GrafanaInstancesService,
    GrafanaDashboardsService,
    GrafanaClientService,
    ApplicationDashboardsService
  ],
})
export class GrafanaModule implements OnModuleInit {
  constructor(private readonly auditRegistry: AuditResourceRegistry) {}

  onModuleInit(): void {
    this.auditRegistry.register('grafana-instances', GrafanaInstance);
    this.auditRegistry.register('grafana-dashboards', GrafanaDashboard);
    this.auditRegistry.register('application-dashboards', ApplicationDashboard);
  }
}
