import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApplicationDashboard, SeriesGroupingRule } from '@perfana/shared/entities';
import { CommonModule } from '../../common/common.module';
import { AuditModule } from '../audit/audit.module';
import { AuditResourceRegistry } from '../audit/audit-resource-registry';
import { SeriesGroupingController } from './series-grouping.controller';
import { SeriesGroupingService } from './series-grouping.service';

/** Series grouping rules (docs/design/2026-11-01-series-grouping-design.md). */
@Module({
  imports: [
    TypeOrmModule.forFeature([SeriesGroupingRule, ApplicationDashboard]),
    CommonModule, // AuthorizationService
    AuditModule, // AuditService + AuditResourceRegistry
  ],
  controllers: [SeriesGroupingController],
  providers: [SeriesGroupingService],
  exports: [SeriesGroupingService],
})
export class SeriesGroupingModule implements OnModuleInit {
  constructor(private readonly auditRegistry: AuditResourceRegistry) {}

  onModuleInit(): void {
    this.auditRegistry.register('series-grouping-rules', SeriesGroupingRule);
  }
}
