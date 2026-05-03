import { Module, OnModuleInit, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DynatraceController } from './dynatrace.controller';
import { DynatraceService } from './dynatrace.service';
import { DynatraceRepository } from './dynatrace.repository';
import { AuthModule } from '../auth/auth.module';
import { TestRunsModule } from '../test-runs/test-runs.module';
import { CommonModule } from '../../common/common.module';
import { AuditModule } from '../audit/audit.module';
import { AuditResourceRegistry } from '../audit/audit-resource-registry';
import {
  DynatraceConfig,
  DynatraceQuery,
  DynatraceEntityMapping,
  DsPanels,
  DsMetrics,
  MetricsSource,
} from '../../entities';

@Module({
  imports: [
    AuthModule,
    forwardRef(() => TestRunsModule), // ForwardRef to handle circular dependency
    TypeOrmModule.forFeature([
      DynatraceConfig,
      DynatraceQuery,
      DynatraceEntityMapping,
      DsPanels,
      DsMetrics,
      MetricsSource,
    ]),
    CommonModule, // Provides AuthorizationService for RBAC
    AuditModule, // Phase 5a: provides AuditService + AuditResourceRegistry
  ],
  controllers: [DynatraceController],
  providers: [DynatraceService, DynatraceRepository],
  exports: [DynatraceService],
})
export class DynatraceModule implements OnModuleInit {
  constructor(private readonly auditRegistry: AuditResourceRegistry) {}

  onModuleInit(): void {
    this.auditRegistry.register('dynatrace-configs', DynatraceConfig);
    this.auditRegistry.register('dynatrace-queries', DynatraceQuery);
    this.auditRegistry.register('dynatrace-entity-mappings', DynatraceEntityMapping);
  }
}