/**
 * Report DTOs - Data Transfer Objects for the Custom Reporting Feature
 *
 * This module exports all DTOs for:
 * - Report generation (from template and ad-hoc)
 * - Template CRUD operations
 * - Response types for API endpoints
 */

// Report Generation DTOs
export {
  // Types and constants
  REPORT_SECTION_TYPES,
  type ReportSectionType,
  // Section configuration
  ReportSectionConfigDto,
  ReportStylingDto,
  // Report generation requests
  GenerateReportFromTemplateDto,
  GenerateAdHocReportDto,
  GeneratePdfDto,
  // Section preview
  PreviewSectionDto,
  // Share management
  UpdateShareSettingsDto,
  // Query parameters
  ListReportsQueryDto,
  // Path parameters
  ReportParamsDto,
  TestRunReportParamsDto,
  ShareParamsDto,
} from './create-report.dto';

// Template Management DTOs
export {
  // Template CRUD
  CreateTemplateDto,
  UpdateTemplateDto,
  // Section management
  AddSectionDto,
  ReorderSectionsDto,
  // Template operations
  DuplicateTemplateDto,
  // Query parameters
  ListTemplatesQueryDto,
  // Path parameters
  TemplateParamsDto,
  SectionParamsDto,
} from './create-template.dto';

// Response DTOs
export {
  // Types and constants
  REPORT_STATUS_VALUES,
  type ReportStatus,
  // Generation responses
  GenerateReportResponseDto,
  GeneratePdfResponseDto,
  // Share responses
  ShareSettingsResponseDto,
  PublicShareResponseDto,
  // Report list/detail responses
  ReportListItemDto,
  ReportListResponseDto,
  ReportSummaryDto,
  ReportDetailDto,
  // Template responses
  TemplateListItemDto,
  TemplateListResponseDto,
  TemplateDetailDto,
  TemplateSummaryDto,
  // Job progress
  JobProgressDto,
} from './report-response.dto';
