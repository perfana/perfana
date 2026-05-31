/**
 * AWR DTOs
 *
 * Data Transfer Objects for AWR report operations including upload,
 * response formatting, and comparison requests.
 */

// Upload DTOs
export {
  UploadAwrReportDto,
  UploadAwrReportByUrlDto,
  ListAwrReportsQueryDto,
} from './upload-awr-report.dto';

// Response DTOs
export {
  DatabaseInfoResponseDto,
  HostInfoResponseDto,
  SnapshotInfoResponseDto,
  AwrReportResponseDto,
  AwrReportListItemDto,
  AwrReportListResponseDto,
  AwrAnalysisResponseDto,
  AwrReportSummaryResponseDto,
  UploadAwrReportResponseDto,
} from './awr-report-response.dto';

// Comparison DTOs
export {
  CompareReportsDto,
  CompareTestRunAwrReportsDto,
  ComparisonResponseDto,
  ComparisonSummaryDto,
  AvailableBaselineDto,
  AvailableBaselinesResponseDto,
} from './compare-reports.dto';
