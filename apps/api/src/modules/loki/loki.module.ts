import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GrafanaInstance, LokiConfig, LokiQuery, LokiStreamMapping, MetricsSource, SystemUnderTest, TestRun } from '../../entities';
import { CommonModule } from '../../common/common.module';
import { AuditModule } from '../audit/audit.module';
import { AuditResourceRegistry } from '../audit/audit-resource-registry';
import { ProxyModule } from '../proxy/proxy.module';
import { LokiController } from './loki.controller';
import { LokiService } from './loki.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([LokiConfig, LokiStreamMapping, LokiQuery, GrafanaInstance, SystemUnderTest, MetricsSource, TestRun]),
    CommonModule,
    AuditModule,
    ProxyModule,
  ],
  controllers: [LokiController],
  providers: [LokiService],
  exports: [LokiService],
})
export class LokiModule implements OnModuleInit {
  constructor(private readonly auditRegistry: AuditResourceRegistry) {}

  onModuleInit(): void {
    this.auditRegistry.register('loki-configs', LokiConfig);
    this.auditRegistry.register('loki-stream-mappings', LokiStreamMapping);
    this.auditRegistry.register('loki-queries', LokiQuery);
  }
}
