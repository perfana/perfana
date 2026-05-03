import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GeneratedReport, ReportTemplate, TestRun, SystemUnderTest } from '@perfana/shared';
import { ReportGenerationController } from './controllers/report-generation.controller';
import { ReportTemplateController } from './controllers/report-template.controller';
import { ReportShareController } from './controllers/report-share.controller';
import { ReportGenerationService } from './services/report-generation.service';
import { ReportTemplateService } from './services/report-template.service';
import { ReportShareService } from './services/report-share.service';
import { HtmlGenerationProcessor } from './processors/html-generation.processor';
import { PdfGenerationProcessor } from './processors/pdf-generation.processor';
import { CommonModule } from '../../common/common.module';

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
import { PlaceholderRenderer } from './renderers/placeholder-renderer';

@Module({
  imports: [
    TypeOrmModule.forFeature([GeneratedReport, ReportTemplate, TestRun, SystemUnderTest]),
    CommonModule, // Provides AuthorizationService
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
    PlaceholderRenderer,
  ],
  exports: [
    ReportGenerationService,
    ReportTemplateService,
    ReportShareService,
    HtmlGenerationProcessor,
    PdfGenerationProcessor,
  ],
})
export class ReportsModule {}