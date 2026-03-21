import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { ParseStatus, FileType } from '../entities/awr-report.entity';
import type { AnalysisType, InsightSeverity, AwrInsight, SeveritySummary } from '../entities/awr-analysis.entity';

/**
 * Database information response DTO
 */
export class DatabaseInfoResponseDto {
  @ApiPropertyOptional({ description: 'Database name', example: 'ORCL' })
  dbName?: string;

  @ApiPropertyOptional({ description: 'Database ID', example: '1234567890' })
  dbId?: string;

  @ApiPropertyOptional({ description: 'Instance name', example: 'orcl1' })
  instanceName?: string;

  @ApiPropertyOptional({ description: 'Database edition', example: 'Enterprise Edition' })
  dbEdition?: string;

  @ApiPropertyOptional({ description: 'Database release version', example: '19.3.0.0.0' })
  dbRelease?: string;

  @ApiPropertyOptional({ description: 'Whether this is a RAC database', example: false })
  isRac?: boolean;

  @ApiPropertyOptional({ description: 'Whether this is a Container Database', example: true })
  isCdb?: boolean;
}

/**
 * Host information response DTO
 */
export class HostInfoResponseDto {
  @ApiPropertyOptional({ description: 'Host name', example: 'db-server-01' })
  hostName?: string;

  @ApiPropertyOptional({ description: 'Platform/OS', example: 'Linux x86 64-bit' })
  platform?: string;

  @ApiPropertyOptional({ description: 'Number of CPUs', example: 16 })
  cpus?: number;

  @ApiPropertyOptional({ description: 'Number of cores', example: 8 })
  cores?: number;

  @ApiPropertyOptional({ description: 'Number of CPU sockets', example: 2 })
  sockets?: number;

  @ApiPropertyOptional({ description: 'Total memory in GB', example: 128 })
  memoryGb?: number;
}

/**
 * Snapshot information response DTO
 */
export class SnapshotInfoResponseDto {
  @ApiPropertyOptional({ description: 'Beginning snapshot ID', example: 100 })
  snapIdBegin?: number;

  @ApiPropertyOptional({ description: 'Ending snapshot ID', example: 101 })
  snapIdEnd?: number;

  @ApiPropertyOptional({
    description: 'Snapshot begin time',
    example: '2024-01-15T10:00:00Z',
    type: String,
  })
  beginTime?: Date;

  @ApiPropertyOptional({
    description: 'Snapshot end time',
    example: '2024-01-15T11:00:00Z',
    type: String,
  })
  endTime?: Date;

  @ApiPropertyOptional({ description: 'Elapsed time in minutes', example: 60 })
  elapsedMinutes?: number;

  @ApiPropertyOptional({ description: 'Total DB time in minutes', example: 45.5 })
  dbTimeMinutes?: number;

  @ApiPropertyOptional({ description: 'Sessions at begin', example: 50 })
  sessionsBegin?: number;

  @ApiPropertyOptional({ description: 'Sessions at end', example: 55 })
  sessionsEnd?: number;
}

/**
 * AWR Report response DTO
 * Full representation of an AWR report with all metadata
 */
export class AwrReportResponseDto {
  @ApiProperty({
    description: 'Unique report ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id!: string;

  @ApiProperty({
    description: 'Associated test run ID',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  testRunId!: string;

  // File Metadata
  @ApiProperty({ description: 'Original file name', example: 'awrrpt_1_100_101.html' })
  fileName!: string;

  @ApiProperty({ description: 'File size in bytes', example: 524288 })
  fileSize!: number;

  @ApiProperty({
    description: 'File type',
    example: 'html',
    enum: ['html', 'text'],
  })
  fileType!: FileType;

  // Database Metadata
  @ApiPropertyOptional({ type: DatabaseInfoResponseDto })
  database?: DatabaseInfoResponseDto;

  // Host Information
  @ApiPropertyOptional({ type: HostInfoResponseDto })
  host?: HostInfoResponseDto;

  // Snapshot Information
  @ApiPropertyOptional({ type: SnapshotInfoResponseDto })
  snapshot?: SnapshotInfoResponseDto;

  // Parse Status
  @ApiProperty({
    description: 'Current parse status',
    example: 'completed',
    enum: ['pending', 'parsing', 'completed', 'failed'],
  })
  parseStatus!: ParseStatus;

  @ApiPropertyOptional({ description: 'Parse error message if failed', example: null })
  parseError?: string;

  @ApiPropertyOptional({
    description: 'When parsing completed',
    example: '2024-01-15T12:00:00Z',
    type: String,
  })
  parsedAt?: Date;

  // Upload Information
  @ApiProperty({
    description: 'When the report was uploaded',
    example: '2024-01-15T11:30:00Z',
    type: String,
  })
  uploadedAt!: Date;

  @ApiProperty({ description: 'User who uploaded the report', example: 'user@example.com' })
  uploadedBy!: string;

  // Parsed Data (JSONB content)
  @ApiPropertyOptional({
    description: 'Parsed AWR data including load profile, top SQL, wait events, etc.',
    type: 'object',
    additionalProperties: true,
  })
  parsedData?: Record<string, unknown>;

  // Analysis Summary (if available)
  @ApiPropertyOptional({ description: 'Whether analysis is available', example: true })
  hasAnalysis?: boolean;

  @ApiPropertyOptional({
    description: 'Severity summary from analysis',
    example: { critical: 1, warning: 3, info: 5, total: 9 },
  })
  severitySummary?: SeveritySummary;
}

/**
 * AWR Report list item DTO (compact version for list views)
 */
export class AwrReportListItemDto {
  @ApiProperty({
    description: 'Unique report ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id!: string;

  @ApiProperty({
    description: 'Associated test run ID',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  testRunId!: string;

  @ApiProperty({ description: 'Original file name', example: 'awrrpt_1_100_101.html' })
  fileName!: string;

  @ApiProperty({ description: 'File size in bytes', example: 524288 })
  fileSize!: number;

  @ApiPropertyOptional({ description: 'Database name', example: 'ORCL' })
  dbName?: string;

  @ApiPropertyOptional({
    description: 'Snapshot begin time',
    example: '2024-01-15T10:00:00Z',
    type: String,
  })
  beginTime?: Date;

  @ApiPropertyOptional({
    description: 'Snapshot end time',
    example: '2024-01-15T11:00:00Z',
    type: String,
  })
  endTime?: Date;

  @ApiProperty({
    description: 'Current parse status',
    example: 'completed',
    enum: ['pending', 'parsing', 'completed', 'failed'],
  })
  parseStatus!: ParseStatus;

  @ApiProperty({
    description: 'When the report was uploaded',
    example: '2024-01-15T11:30:00Z',
    type: String,
  })
  uploadedAt!: Date;

  @ApiPropertyOptional({
    description: 'Severity summary from analysis',
    example: { critical: 1, warning: 3, info: 5, total: 9 },
  })
  severitySummary?: SeveritySummary;
}

/**
 * AWR Report list response with pagination
 */
export class AwrReportListResponseDto {
  @ApiProperty({
    description: 'List of AWR reports',
    type: [AwrReportListItemDto],
  })
  items!: AwrReportListItemDto[];

  @ApiProperty({ description: 'Total number of reports matching the query', example: 42 })
  total!: number;

  @ApiProperty({ description: 'Current page offset', example: 0 })
  offset!: number;

  @ApiProperty({ description: 'Page size limit', example: 50 })
  limit!: number;
}

/**
 * AWR Analysis response DTO
 */
export class AwrAnalysisResponseDto {
  @ApiProperty({
    description: 'Analysis ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id!: string;

  @ApiProperty({
    description: 'AWR report ID that was analyzed',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  awrReportId!: string;

  @ApiProperty({
    description: 'Analysis type',
    example: 'single',
    enum: ['single', 'comparison'],
  })
  analysisType!: AnalysisType;

  @ApiPropertyOptional({
    description: 'Baseline report ID (for comparison analysis)',
    example: '123e4567-e89b-12d3-a456-426614174002',
  })
  baselineReportId?: string;

  @ApiProperty({
    description: 'Generated insights',
    type: 'array',
    items: { type: 'object' },
    example: [
      {
        id: 'insight-1',
        severity: 'warning',
        category: 'sql_performance',
        title: 'High DB Time SQL',
        description: 'SQL ID abc123 consuming 25% of DB time',
      },
    ],
  })
  insights!: AwrInsight[];

  @ApiProperty({
    description: 'Summary of insights by severity',
    example: { critical: 1, warning: 3, info: 5, total: 9 },
  })
  severitySummary!: SeveritySummary;

  @ApiPropertyOptional({ description: 'Analysis algorithm version', example: '1.0.0' })
  analysisVersion?: string;

  @ApiProperty({
    description: 'When analysis was performed',
    example: '2024-01-15T12:00:00Z',
    type: String,
  })
  analyzedAt!: Date;
}

/**
 * AWR Report summary for collapsed card view
 */
export class AwrReportSummaryResponseDto {
  @ApiProperty({
    description: 'Report ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id!: string;

  @ApiPropertyOptional({ description: 'Database name', example: 'ORCL' })
  dbName?: string;

  @ApiPropertyOptional({
    description: 'Snapshot begin time',
    example: '2024-01-15T10:00:00Z',
    type: String,
  })
  beginTime?: Date;

  @ApiPropertyOptional({
    description: 'Snapshot end time',
    example: '2024-01-15T11:00:00Z',
    type: String,
  })
  endTime?: Date;

  @ApiPropertyOptional({ description: 'Elapsed time in minutes', example: 60 })
  elapsedMinutes?: number;

  @ApiPropertyOptional({ description: 'DB time in minutes', example: 45.5 })
  dbTimeMinutes?: number;

  @ApiPropertyOptional({ description: 'Transactions per second', example: 125.5 })
  transactionsPerSecond?: number;

  @ApiPropertyOptional({ description: 'Average active sessions', example: 5.2 })
  avgActiveSessions?: number;

  @ApiProperty({
    description: 'Parse status',
    example: 'completed',
    enum: ['pending', 'parsing', 'completed', 'failed'],
  })
  parseStatus!: ParseStatus;

  @ApiPropertyOptional({
    description: 'Severity summary from analysis',
    example: { critical: 1, warning: 3, info: 5, total: 9 },
  })
  severitySummary?: SeveritySummary;

  @ApiPropertyOptional({
    description: 'Top issue if available',
    example: { severity: 'critical', title: 'High DB Time SQL' },
  })
  topIssue?: {
    severity: InsightSeverity;
    title: string;
  };
}

/**
 * Upload response DTO returned after successful upload
 */
export class UploadAwrReportResponseDto {
  @ApiProperty({
    description: 'Created report ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id!: string;

  @ApiProperty({ description: 'Original file name', example: 'awrrpt_1_100_101.html' })
  fileName!: string;

  @ApiProperty({ description: 'File size in bytes', example: 524288 })
  fileSize!: number;

  @ApiProperty({
    description: 'Current parse status',
    example: 'pending',
    enum: ['pending', 'parsing', 'completed', 'failed'],
  })
  parseStatus!: ParseStatus;

  @ApiProperty({ description: 'Success message', example: 'AWR report uploaded successfully' })
  message!: string;
}
