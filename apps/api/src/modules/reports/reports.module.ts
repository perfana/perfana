import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GeneratedReport, ReportTemplate, TestRun, SystemUnderTest, TestRunConfiguration } from '@perfana/shared';
import { ReportGenerationController } from './controllers/report-generation.controller';
import { ReportTemplateController } from './controllers/report-template.controller';
import { ReportShareController } from './controllers/report-share.controller';
import { ReportGenerationService } from './services/report-generation.service';
import { ReportTemplateService } from './services/report-template.service';
import { ReportShareService } from './services/report-share.service';
import { HtmlGenerationProcessor } from './processors/html-generation.processor';
import { PdfGenerationProcessor } from './processors/pdf-generation.processor';
import { CommonModule } from '../../common/common.module';
import { AuditModule } from '../audit/audit.module';
import { AuditResourceRegistry } from '../audit/audit-resource-registry';

// Report Generation Services (Orchestrator Pattern)
import { ReportGenerationValidatorService } from './services/report-generation-validator.service';
import { ReportDataFetcherService } from './services/report-data-fetcher.service';
import { ReportUtilsService } from './services/report-utils.service';
import { ReportHtmlCompilerService } from './services/report-html-compiler.service';

// Section Renderers
import { HeaderRenderer } from './renderers/header-renderer';
import { TextBlockRenderer } from './renderers/text-block-renderer';
import { SloRenderer } from './renderers/slo-renderer';
import { ApdexRenderer } from './renderers/apdex-renderer';
import { TransactionResponseTimesRenderer } from './renderers/transaction-response-times-renderer';
import { RegressionsRenderer } from './renderers/regressions-renderer';
import { AwrRenderer } from './renderers/awr-renderer';
import { TrendsRenderer } from './renderers/trends-renderer';
import { ComparisonsRenderer } from './renderers/comparisons-renderer';
import { GraphsRenderer } from './renderers/graphs-renderer';
import { Top10ListsRenderer } from './renderers/top-10-lists-renderer';
import { ErrorAnalysisRenderer } from './renderers/error-analysis-renderer';
import { PlaceholderRenderer } from './renderers/placeholder-renderer';
import { IndexRenderer } from './renderers/index-renderer';

@Module({
  imports: [
    TypeOrmModule.forFeature([GeneratedReport, ReportTemplate, TestRun, SystemUnderTest, TestRunConfiguration]),
    CommonModule, // Provides AuthorizationService
    AuditModule, // Phase 5a — provides AuditService + AuditResourceRegistry
  ],
  controllers: [ReportGenerationController, ReportTemplateController, ReportShareController],
  providers: [
    // Core Services
    ReportGenerationService,
    ReportTemplateService,
    ReportShareService,

    // Processors
    HtmlGenerationProcessor,
    PdfGenerationProcessor,

    // Report Generation Services (Orchestrator Pattern)
    ReportGenerationValidatorService,
    ReportDataFetcherService,
    ReportUtilsService,
    ReportHtmlCompilerService,

    // Section Renderers
    HeaderRenderer,
    TextBlockRenderer,
    SloRenderer,
    ApdexRenderer,
    TransactionResponseTimesRenderer,
    RegressionsRenderer,
    AwrRenderer,
    TrendsRenderer,
    ComparisonsRenderer,
    GraphsRenderer,
    Top10ListsRenderer,
    ErrorAnalysisRenderer,
    PlaceholderRenderer,
    IndexRenderer,
  ],
  exports: [
    ReportGenerationService,
    ReportTemplateService,
    ReportShareService,
    HtmlGenerationProcessor,
    PdfGenerationProcessor,
  ],
})
export class ReportsModule implements OnModuleInit {
  constructor(private readonly auditRegistry: AuditResourceRegistry) {}

  onModuleInit(): void {
    // Phase 5a — both entities are registered so the per-resource audit
    // history endpoint can resolve their types. ReportTemplate gets full CRUD
    // rows; GeneratedReport gets DELETE-only rows (per the brainstorm).
    this.auditRegistry.register('report-templates', ReportTemplate);
    this.auditRegistry.register('generated-reports', GeneratedReport);
  }
}