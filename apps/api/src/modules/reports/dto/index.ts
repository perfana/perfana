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
  type ReportSectionType,
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
} from './create-template.dto';

// Response DTOs
export {
  // Types and constants
  type ReportStatus,
  // Generation responses
  GenerateReportResponseDto,
  GeneratePdfResponseDto,
  // Share responses
  ShareSettingsResponseDto,
  PublicShareResponseDto,
  // Report list/detail responses
  ReportListResponseDto,
  ReportSummaryDto,
  ReportDetailDto,
  // Template responses
  TemplateListResponseDto,
  TemplateDetailDto,
  TemplateSummaryDto,
} from './report-response.dto';
