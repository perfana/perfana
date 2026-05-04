import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from '@perfana/shared/entities';
import { GrafanaSyncAuditService } from './grafana-sync-audit.service';

/**
 * Provides {@link GrafanaSyncAuditService} for service-layer audit calls
 * (logCreate / logUpdate) inside grafana-sync. Stamps a fixed
 * `system:grafana-sync` actor since this app has no HTTP request context.
 */
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  providers: [GrafanaSyncAuditService],
  exports: [GrafanaSyncAuditService],
})
export class AuditModule {}
