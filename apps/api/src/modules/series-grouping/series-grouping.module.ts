import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApplicationDashboard, SeriesGroupingRule } from '@perfana/shared/entities';
import { CommonModule } from '../../common/common.module';
import { TestRun } from '../../entities';
import { AuditModule } from '../audit/audit.module';
import { AuditResourceRegistry } from '../audit/audit-resource-registry';
import { DataScienceModule } from '../data-science/data-science.module';
import { SeriesGroupingController } from './series-grouping.controller';
import { SeriesGroupingService } from './series-grouping.service';
import { SeriesGroupingInsightsController } from './series-grouping-insights.controller';
import { SeriesGroupingTestRunController } from './series-grouping-test-run.controller';
import { SeriesGroupingInsightsService } from './series-grouping-insights.service';

/** Series grouping rules (docs/design/2026-11-01-series-grouping-design.md). */
@Module({
  imports: [
    TypeOrmModule.forFeature([SeriesGroupingRule, ApplicationDashboard, TestRun]),
    CommonModule, // AuthorizationService
    AuditModule, // AuditService + AuditResourceRegistry
    DataScienceModule, // BullMQClientService, for POST /series-grouping-rules/apply
  ],
  // Order matters for the shared `series-grouping-rules` prefix only in that no static path may
  // sit behind `:id`; the insights routes are POST-only, so none collides with GET /:id.
  controllers: [SeriesGroupingInsightsController, SeriesGroupingController, SeriesGroupingTestRunController],
  providers: [SeriesGroupingService, SeriesGroupingInsightsService],
  exports: [SeriesGroupingService],
})
export class SeriesGroupingModule implements OnModuleInit {
  constructor(private readonly auditRegistry: AuditResourceRegistry) {}

  onModuleInit(): void {
    this.auditRegistry.register('series-grouping-rules', SeriesGroupingRule);
  }
}
