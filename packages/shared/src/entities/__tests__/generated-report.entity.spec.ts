/**
 * Unit tests for GeneratedReport Entity
 *
 * Tests verify:
 * - Entity structure matches database schema (generated_reports table)
 * - TypeORM decorators are properly applied
 * - Column types and constraints
 * - Required vs nullable fields
 * - Default values
 * - Database indexes
 * - Relationships (ManyToOne to TestRun and ReportTemplate)
 * - Types: ReportStatus, ReportFileMetadata
 */

import 'reflect-metadata';
import { getMetadataArgsStorage } from 'typeorm';
import {
  GeneratedReport,
  ReportStatus,
  ReportFileMetadata,
} from '../generated-report.entity';

describe('GeneratedReport Entity', () => {
  describe('Entity Class', () => {
    it('should be defined', () => {
      expect(GeneratedReport).toBeDefined();
    });

    it('should be instantiable', () => {
      const report = new GeneratedReport();
      expect(report).toBeInstanceOf(GeneratedReport);
    });

    it('should have all required properties', () => {
      const report = new GeneratedReport();

      // Core required fields
      expect('id' in report).toBe(true);
      expect('test_run_id' in report).toBe(true);
      expect('template_id' in report).toBe(true);
      expect('name' in report).toBe(true);
      expect('generated_by' in report).toBe(true);
      expect('status' in report).toBe(true);
      expect('share_id' in report).toBe(true);
      expect('share_enabled' in report).toBe(true);
      expect('share_view_count' in report).toBe(true);
      expect('mime_type' in report).toBe(true);
      expect('retry_count' in report).toBe(true);
      expect('max_retries' in report).toBe(true);
      expect('download_count' in report).toBe(true);
      expect('created_at' in report).toBe(true);
      expect('updated_at' in report).toBe(true);
    });

    it('should have all optional properties', () => {
      const report = new GeneratedReport();

      // Optional fields
      expect('html_content' in report).toBe(true);
      expect('html_generated_at' in report).toBe(true);
      expect('last_shared_at' in report).toBe(true);
      expect('pdf_data' in report).toBe(true);
      expect('file_path' in report).toBe(true);
      expect('file_size' in report).toBe(true);
      expect('file_metadata' in report).toBe(true);
      expect('error_code' in report).toBe(true);
      expect('error_message' in report).toBe(true);
      expect('job_id' in report).toBe(true);
      expect('last_downloaded_at' in report).toBe(true);
      expect('expires_at' in report).toBe(true);
      expect('started_at' in report).toBe(true);
      expect('completed_at' in report).toBe(true);
      expect('test_run' in report).toBe(true);
      expect('template' in report).toBe(true);
    });
  });

  describe('TypeORM Entity Metadata', () => {
    it('should be registered as an entity', () => {
      const tables = getMetadataArgsStorage().tables;
      const entityMeta = tables.find(
        (t) => t.target === GeneratedReport
      );

      expect(entityMeta).toBeDefined();
      expect(entityMeta?.name).toBe('generated_reports');
    });

    it('should have all columns defined', () => {
      const columns = getMetadataArgsStorage().columns;
      const entityColumns = columns.filter(
        (c) => c.target === GeneratedReport
      );

      // Count expected columns (27 columns total without relationships)
      expect(entityColumns.length).toBeGreaterThanOrEqual(27);
    });

    it('should have UUID primary key', () => {
      const primaryColumns = getMetadataArgsStorage().columns;
      const idColumn = primaryColumns.find(
        (c) => c.target === GeneratedReport && c.propertyName === 'id'
      );

      expect(idColumn).toBeDefined();
    });
  });

  describe('Database Indexes', () => {
    it('should have index on test_run_id', () => {
      const indices = getMetadataArgsStorage().indices;
      const testRunIndex = indices.find(
        (i) =>
          i.target === GeneratedReport &&
          i.name === 'idx_generated_reports_test_run_id'
      );

      expect(testRunIndex).toBeDefined();
    });

    it('should have index on template_id', () => {
      const indices = getMetadataArgsStorage().indices;
      const templateIndex = indices.find(
        (i) =>
          i.target === GeneratedReport &&
          i.name === 'idx_generated_reports_template_id'
      );

      expect(templateIndex).toBeDefined();
    });

    it('should have unique index on share_id', () => {
      const indices = getMetadataArgsStorage().indices;
      const shareIndex = indices.find(
        (i) =>
          i.target === GeneratedReport &&
          i.name === 'idx_generated_reports_share_id'
      );

      expect(shareIndex).toBeDefined();
      expect(shareIndex?.unique).toBe(true);
    });

    it('should have index on status', () => {
      const indices = getMetadataArgsStorage().indices;
      const statusIndex = indices.find(
        (i) =>
          i.target === GeneratedReport &&
          i.name === 'idx_generated_reports_status'
      );

      expect(statusIndex).toBeDefined();
    });

    it('should have index on created_at', () => {
      const indices = getMetadataArgsStorage().indices;
      const createdAtIndex = indices.find(
        (i) =>
          i.target === GeneratedReport &&
          i.name === 'idx_generated_reports_created_at'
      );

      expect(createdAtIndex).toBeDefined();
    });
  });

  describe('Column Types', () => {
    describe('Core Fields', () => {
      it('should have UUID columns for IDs', () => {
        const columns = getMetadataArgsStorage().columns;
        const entityColumns = columns.filter(
          (c) => c.target === GeneratedReport
        );

        const testRunIdCol = entityColumns.find(
          (c) => c.propertyName === 'test_run_id'
        );
        expect(testRunIdCol?.options?.type).toBe('uuid');

        const templateIdCol = entityColumns.find(
          (c) => c.propertyName === 'template_id'
        );
        expect(templateIdCol?.options?.type).toBe('uuid');

        const shareIdCol = entityColumns.find(
          (c) => c.propertyName === 'share_id'
        );
        expect(shareIdCol?.options?.type).toBe('uuid');
      });

      it('should have varchar columns with correct lengths', () => {
        const columns = getMetadataArgsStorage().columns;
        const entityColumns = columns.filter(
          (c) => c.target === GeneratedReport
        );

        const nameCol = entityColumns.find(
          (c) => c.propertyName === 'name'
        );
        expect(nameCol?.options?.type).toBe('varchar');
        expect(nameCol?.options?.length).toBe(255);

        const generatedByCol = entityColumns.find(
          (c) => c.propertyName === 'generated_by'
        );
        expect(generatedByCol?.options?.type).toBe('varchar');
        expect(generatedByCol?.options?.length).toBe(255);

        const statusCol = entityColumns.find(
          (c) => c.propertyName === 'status'
        );
        expect(statusCol?.options?.type).toBe('varchar');
        expect(statusCol?.options?.length).toBe(20);

        const mimeTypeCol = entityColumns.find(
          (c) => c.propertyName === 'mime_type'
        );
        expect(mimeTypeCol?.options?.type).toBe('varchar');
        expect(mimeTypeCol?.options?.length).toBe(100);
      });
    });

    describe('HTML Content Fields', () => {
      it('should have text column for html_content', () => {
        const columns = getMetadataArgsStorage().columns;
        const htmlContentCol = columns.find(
          (c) =>
            c.target === GeneratedReport &&
            c.propertyName === 'html_content'
        );

        expect(htmlContentCol?.options?.type).toBe('text');
        expect(htmlContentCol?.options?.nullable).toBe(true);
      });

      it('should have timestamptz for html_generated_at', () => {
        const columns = getMetadataArgsStorage().columns;
        const htmlGenCol = columns.find(
          (c) =>
            c.target === GeneratedReport &&
            c.propertyName === 'html_generated_at'
        );

        expect(htmlGenCol?.options?.type).toBe('timestamptz');
        expect(htmlGenCol?.options?.nullable).toBe(true);
      });
    });

    describe('Share Fields', () => {
      it('should have share_id with unique constraint and default', () => {
        const columns = getMetadataArgsStorage().columns;
        const shareIdCol = columns.find(
          (c) =>
            c.target === GeneratedReport &&
            c.propertyName === 'share_id'
        );

        expect(shareIdCol?.options?.type).toBe('uuid');
        expect(shareIdCol?.options?.unique).toBe(true);
      });

      it('should have boolean share_enabled with default false', () => {
        const columns = getMetadataArgsStorage().columns;
        const shareEnabledCol = columns.find(
          (c) =>
            c.target === GeneratedReport &&
            c.propertyName === 'share_enabled'
        );

        expect(shareEnabledCol?.options?.type).toBe('boolean');
        expect(shareEnabledCol?.options?.default).toBe(false);
      });

      it('should have integer share_view_count with default 0', () => {
        const columns = getMetadataArgsStorage().columns;
        const viewCountCol = columns.find(
          (c) =>
            c.target === GeneratedReport &&
            c.propertyName === 'share_view_count'
        );

        expect(viewCountCol?.options?.type).toBe('integer');
        expect(viewCountCol?.options?.default).toBe(0);
      });
    });

    describe('PDF Storage Fields', () => {
      it('should have bytea column for pdf_data', () => {
        const columns = getMetadataArgsStorage().columns;
        const pdfDataCol = columns.find(
          (c) =>
            c.target === GeneratedReport &&
            c.propertyName === 'pdf_data'
        );

        expect(pdfDataCol?.options?.type).toBe('bytea');
        expect(pdfDataCol?.options?.nullable).toBe(true);
      });

      it('should have varchar for file_path', () => {
        const columns = getMetadataArgsStorage().columns;
        const filePathCol = columns.find(
          (c) =>
            c.target === GeneratedReport &&
            c.propertyName === 'file_path'
        );

        expect(filePathCol?.options?.type).toBe('varchar');
        expect(filePathCol?.options?.length).toBe(1024);
        expect(filePathCol?.options?.nullable).toBe(true);
      });

      it('should have bigint for file_size', () => {
        const columns = getMetadataArgsStorage().columns;
        const fileSizeCol = columns.find(
          (c) =>
            c.target === GeneratedReport &&
            c.propertyName === 'file_size'
        );

        expect(fileSizeCol?.options?.type).toBe('bigint');
        expect(fileSizeCol?.options?.nullable).toBe(true);
      });

      it('should have jsonb for file_metadata', () => {
        const columns = getMetadataArgsStorage().columns;
        const fileMetaCol = columns.find(
          (c) =>
            c.target === GeneratedReport &&
            c.propertyName === 'file_metadata'
        );

        expect(fileMetaCol?.options?.type).toBe('jsonb');
        expect(fileMetaCol?.options?.nullable).toBe(true);
      });
    });

    describe('Status & Error Fields', () => {
      it('should have status column with default pending', () => {
        const columns = getMetadataArgsStorage().columns;
        const statusCol = columns.find(
          (c) =>
            c.target === GeneratedReport &&
            c.propertyName === 'status'
        );

        expect(statusCol?.options?.default).toBe('pending');
      });

      it('should have nullable error columns', () => {
        const columns = getMetadataArgsStorage().columns;

        const errorCodeCol = columns.find(
          (c) =>
            c.target === GeneratedReport &&
            c.propertyName === 'error_code'
        );
        expect(errorCodeCol?.options?.nullable).toBe(true);

        const errorMsgCol = columns.find(
          (c) =>
            c.target === GeneratedReport &&
            c.propertyName === 'error_message'
        );
        expect(errorMsgCol?.options?.nullable).toBe(true);
        expect(errorMsgCol?.options?.type).toBe('text');
      });
    });

    describe('Job Processing Fields', () => {
      it('should have job_id column', () => {
        const columns = getMetadataArgsStorage().columns;
        const jobIdCol = columns.find(
          (c) =>
            c.target === GeneratedReport &&
            c.propertyName === 'job_id'
        );

        expect(jobIdCol?.options?.type).toBe('varchar');
        expect(jobIdCol?.options?.length).toBe(100);
        expect(jobIdCol?.options?.nullable).toBe(true);
      });

      it('should have retry_count with default 0', () => {
        const columns = getMetadataArgsStorage().columns;
        const retryCountCol = columns.find(
          (c) =>
            c.target === GeneratedReport &&
            c.propertyName === 'retry_count'
        );

        expect(retryCountCol?.options?.type).toBe('integer');
        expect(retryCountCol?.options?.default).toBe(0);
      });

      it('should have max_retries with default 3', () => {
        const columns = getMetadataArgsStorage().columns;
        const maxRetriesCol = columns.find(
          (c) =>
            c.target === GeneratedReport &&
            c.propertyName === 'max_retries'
        );

        expect(maxRetriesCol?.options?.type).toBe('integer');
        expect(maxRetriesCol?.options?.default).toBe(3);
      });
    });

    describe('Download Tracking Fields', () => {
      it('should have download_count with default 0', () => {
        const columns = getMetadataArgsStorage().columns;
        const downloadCountCol = columns.find(
          (c) =>
            c.target === GeneratedReport &&
            c.propertyName === 'download_count'
        );

        expect(downloadCountCol?.options?.type).toBe('integer');
        expect(downloadCountCol?.options?.default).toBe(0);
      });

      it('should have nullable last_downloaded_at', () => {
        const columns = getMetadataArgsStorage().columns;
        const lastDownloadedCol = columns.find(
          (c) =>
            c.target === GeneratedReport &&
            c.propertyName === 'last_downloaded_at'
        );

        expect(lastDownloadedCol?.options?.type).toBe('timestamptz');
        expect(lastDownloadedCol?.options?.nullable).toBe(true);
      });
    });

    describe('Timestamp Fields', () => {
      it('should have expires_at as nullable timestamptz', () => {
        const columns = getMetadataArgsStorage().columns;
        const expiresCol = columns.find(
          (c) =>
            c.target === GeneratedReport &&
            c.propertyName === 'expires_at'
        );

        expect(expiresCol?.options?.type).toBe('timestamptz');
        expect(expiresCol?.options?.nullable).toBe(true);
      });

      it('should have started_at as nullable timestamptz', () => {
        const columns = getMetadataArgsStorage().columns;
        const startedCol = columns.find(
          (c) =>
            c.target === GeneratedReport &&
            c.propertyName === 'started_at'
        );

        expect(startedCol?.options?.type).toBe('timestamptz');
        expect(startedCol?.options?.nullable).toBe(true);
      });

      it('should have completed_at as nullable timestamptz', () => {
        const columns = getMetadataArgsStorage().columns;
        const completedCol = columns.find(
          (c) =>
            c.target === GeneratedReport &&
            c.propertyName === 'completed_at'
        );

        expect(completedCol?.options?.type).toBe('timestamptz');
        expect(completedCol?.options?.nullable).toBe(true);
      });
    });
  });

  describe('Relationships', () => {
    it('should have ManyToOne relationship to TestRun', () => {
      const relations = getMetadataArgsStorage().relations;
      const testRunRelation = relations.find(
        (r) =>
          r.target === GeneratedReport &&
          r.propertyName === 'test_run'
      );

      expect(testRunRelation).toBeDefined();
      expect(testRunRelation?.relationType).toBe('many-to-one');
    });

    it('should have ManyToOne relationship to ReportTemplate', () => {
      const relations = getMetadataArgsStorage().relations;
      const templateRelation = relations.find(
        (r) =>
          r.target === GeneratedReport &&
          r.propertyName === 'template'
      );

      expect(templateRelation).toBeDefined();
      expect(templateRelation?.relationType).toBe('many-to-one');
    });

    it('should have JoinColumn for test_run_id', () => {
      const joinColumns = getMetadataArgsStorage().joinColumns;
      const testRunJoin = joinColumns.find(
        (j) =>
          j.target === GeneratedReport &&
          j.propertyName === 'test_run'
      );

      expect(testRunJoin).toBeDefined();
      expect(testRunJoin?.name).toBe('test_run_id');
    });

    it('should have JoinColumn for template_id', () => {
      const joinColumns = getMetadataArgsStorage().joinColumns;
      const templateJoin = joinColumns.find(
        (j) =>
          j.target === GeneratedReport &&
          j.propertyName === 'template'
      );

      expect(templateJoin).toBeDefined();
      expect(templateJoin?.name).toBe('template_id');
    });
  });

  describe('ReportStatus Type', () => {
    it('should include all status values', () => {
      const validStatuses: ReportStatus[] = [
        'pending',
        'processing',
        'html_complete',
        'pdf_processing',
        'pdf_complete',
        'failed',
      ];

      expect(validStatuses).toHaveLength(6);
      validStatuses.forEach((status) => {
        expect(typeof status).toBe('string');
      });
    });

    it('should use underscores in status names', () => {
      const statuses: ReportStatus[] = [
        'pending',
        'processing',
        'html_complete',
        'pdf_processing',
        'pdf_complete',
        'failed',
      ];

      statuses.forEach((status) => {
        expect(status).not.toContain('-');
      });
    });

    it('should follow the expected status flow', () => {
      // Documenting the expected status transitions:
      // pending → processing → html_complete → pdf_processing → pdf_complete
      // Any status → failed

      const initialStatus: ReportStatus = 'pending';
      const processingStatus: ReportStatus = 'processing';
      const htmlCompleteStatus: ReportStatus = 'html_complete';
      const pdfProcessingStatus: ReportStatus = 'pdf_processing';
      const pdfCompleteStatus: ReportStatus = 'pdf_complete';
      const failedStatus: ReportStatus = 'failed';

      expect(initialStatus).toBe('pending');
      expect(processingStatus).toBe('processing');
      expect(htmlCompleteStatus).toBe('html_complete');
      expect(pdfProcessingStatus).toBe('pdf_processing');
      expect(pdfCompleteStatus).toBe('pdf_complete');
      expect(failedStatus).toBe('failed');
    });
  });

  describe('ReportFileMetadata Interface', () => {
    it('should allow empty metadata', () => {
      const metadata: ReportFileMetadata = {};
      expect(Object.keys(metadata)).toHaveLength(0);
    });

    it('should allow filename', () => {
      const metadata: ReportFileMetadata = {
        filename: 'report-2024-01-15.pdf',
      };

      expect(metadata.filename).toBe('report-2024-01-15.pdf');
    });

    it('should allow contentHash', () => {
      const metadata: ReportFileMetadata = {
        contentHash: 'sha256:abc123def456',
      };

      expect(metadata.contentHash).toBe('sha256:abc123def456');
    });

    it('should allow generationDurationMs', () => {
      const metadata: ReportFileMetadata = {
        generationDurationMs: 1500,
      };

      expect(metadata.generationDurationMs).toBe(1500);
    });

    it('should allow puppeteerVersion', () => {
      const metadata: ReportFileMetadata = {
        puppeteerVersion: '21.0.0',
      };

      expect(metadata.puppeteerVersion).toBe('21.0.0');
    });

    it('should allow pageCount', () => {
      const metadata: ReportFileMetadata = {
        pageCount: 5,
      };

      expect(metadata.pageCount).toBe(5);
    });

    it('should allow custom metadata via index signature', () => {
      const metadata: ReportFileMetadata = {
        filename: 'report.pdf',
        customField: 'custom value',
        numericField: 42,
        objectField: { nested: true },
      };

      expect(metadata.customField).toBe('custom value');
      expect(metadata.numericField).toBe(42);
      expect(metadata.objectField).toEqual({ nested: true });
    });

    it('should allow full metadata configuration', () => {
      const metadata: ReportFileMetadata = {
        filename: 'performance-report-2024-01-15.pdf',
        contentHash: 'sha256:abc123def456789',
        generationDurationMs: 2500,
        puppeteerVersion: '21.5.0',
        pageCount: 12,
        paperSize: 'A4',
        margins: { top: '1cm', bottom: '1cm', left: '1cm', right: '1cm' },
      };

      expect(metadata.filename).toBe('performance-report-2024-01-15.pdf');
      expect(metadata.contentHash).toBe('sha256:abc123def456789');
      expect(metadata.generationDurationMs).toBe(2500);
      expect(metadata.puppeteerVersion).toBe('21.5.0');
      expect(metadata.pageCount).toBe(12);
      expect(metadata.paperSize).toBe('A4');
    });
  });

  describe('Entity Instance Operations', () => {
    it('should allow setting all core properties', () => {
      const report = new GeneratedReport();

      report.id = '123e4567-e89b-12d3-a456-426614174000';
      report.test_run_id = '223e4567-e89b-12d3-a456-426614174001';
      report.template_id = '323e4567-e89b-12d3-a456-426614174002';
      report.name = 'Performance Report Q1 2024';
      report.generated_by = 'user@example.com';
      report.status = 'html_complete';
      report.share_id = '423e4567-e89b-12d3-a456-426614174003';
      report.share_enabled = true;
      report.share_view_count = 5;
      report.mime_type = 'application/pdf';
      report.retry_count = 0;
      report.max_retries = 3;
      report.download_count = 10;
      report.created_at = new Date('2024-01-15');
      report.updated_at = new Date('2024-01-15');

      expect(report.id).toBe('123e4567-e89b-12d3-a456-426614174000');
      expect(report.test_run_id).toBe('223e4567-e89b-12d3-a456-426614174001');
      expect(report.template_id).toBe('323e4567-e89b-12d3-a456-426614174002');
      expect(report.name).toBe('Performance Report Q1 2024');
      expect(report.generated_by).toBe('user@example.com');
      expect(report.status).toBe('html_complete');
      expect(report.share_enabled).toBe(true);
      expect(report.share_view_count).toBe(5);
      expect(report.download_count).toBe(10);
    });

    it('should allow setting HTML content', () => {
      const report = new GeneratedReport();

      report.html_content = '<html><body><h1>Report</h1></body></html>';
      report.html_generated_at = new Date('2024-01-15T10:30:00Z');

      expect(report.html_content).toBe(
        '<html><body><h1>Report</h1></body></html>'
      );
      expect(report.html_generated_at).toEqual(
        new Date('2024-01-15T10:30:00Z')
      );
    });

    it('should allow setting PDF file metadata', () => {
      const report = new GeneratedReport();

      report.file_path = '/reports/2024/01/report-123.pdf';
      report.file_size = 1024000;
      report.file_metadata = {
        filename: 'report-123.pdf',
        pageCount: 5,
        generationDurationMs: 1200,
      };

      expect(report.file_path).toBe('/reports/2024/01/report-123.pdf');
      expect(report.file_size).toBe(1024000);
      expect(report.file_metadata?.pageCount).toBe(5);
    });

    it('should allow setting error state', () => {
      const report = new GeneratedReport();

      report.status = 'failed';
      report.error_code = 'GENERATION_TIMEOUT';
      report.error_message = 'Report generation timed out after 30 seconds';

      expect(report.status).toBe('failed');
      expect(report.error_code).toBe('GENERATION_TIMEOUT');
      expect(report.error_message).toBe(
        'Report generation timed out after 30 seconds'
      );
    });

    it('should allow setting job processing state', () => {
      const report = new GeneratedReport();

      report.job_id = 'bull:html-generation:123';
      report.retry_count = 1;
      report.max_retries = 3;
      report.started_at = new Date('2024-01-15T10:00:00Z');
      report.completed_at = new Date('2024-01-15T10:02:30Z');

      expect(report.job_id).toBe('bull:html-generation:123');
      expect(report.retry_count).toBe(1);
      expect(report.max_retries).toBe(3);
      expect(report.started_at).toEqual(new Date('2024-01-15T10:00:00Z'));
      expect(report.completed_at).toEqual(new Date('2024-01-15T10:02:30Z'));
    });

    it('should allow setting share state', () => {
      const report = new GeneratedReport();

      report.share_id = '523e4567-e89b-12d3-a456-426614174004';
      report.share_enabled = true;
      report.share_view_count = 42;
      report.last_shared_at = new Date('2024-01-20T15:00:00Z');
      report.expires_at = new Date('2024-04-20T15:00:00Z');

      expect(report.share_id).toBe('523e4567-e89b-12d3-a456-426614174004');
      expect(report.share_enabled).toBe(true);
      expect(report.share_view_count).toBe(42);
      expect(report.last_shared_at).toEqual(new Date('2024-01-20T15:00:00Z'));
      expect(report.expires_at).toEqual(new Date('2024-04-20T15:00:00Z'));
    });

    it('should handle null/undefined optional fields', () => {
      const report = new GeneratedReport();

      report.html_content = undefined;
      report.error_code = undefined;
      report.job_id = undefined;
      report.expires_at = undefined;

      expect(report.html_content).toBeUndefined();
      expect(report.error_code).toBeUndefined();
      expect(report.job_id).toBeUndefined();
      expect(report.expires_at).toBeUndefined();
    });
  });

  describe('Database Schema Compliance', () => {
    /**
     * These tests verify the entity matches the existing database schema:
     *
     * CREATE TABLE generated_reports (
     *   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     *   test_run_id UUID NOT NULL REFERENCES test_runs(id),
     *   template_id UUID NOT NULL REFERENCES report_templates(id),
     *   name VARCHAR(255) NOT NULL,
     *   generated_by VARCHAR(255) NOT NULL,
     *   html_content TEXT,
     *   html_generated_at TIMESTAMPTZ,
     *   share_id UUID UNIQUE DEFAULT gen_random_uuid(),
     *   share_enabled BOOLEAN DEFAULT false,
     *   share_view_count INTEGER DEFAULT 0,
     *   last_shared_at TIMESTAMPTZ,
     *   pdf_data BYTEA,
     *   file_path VARCHAR(1024),
     *   file_size BIGINT,
     *   mime_type VARCHAR(100) DEFAULT 'application/pdf',
     *   file_metadata JSONB,
     *   status VARCHAR(20) DEFAULT 'pending',
     *   error_code VARCHAR(100),
     *   error_message TEXT,
     *   job_id VARCHAR(100),
     *   retry_count INTEGER DEFAULT 0,
     *   max_retries INTEGER DEFAULT 3,
     *   download_count INTEGER DEFAULT 0,
     *   last_downloaded_at TIMESTAMPTZ,
     *   expires_at TIMESTAMPTZ,
     *   created_at TIMESTAMPTZ DEFAULT NOW(),
     *   updated_at TIMESTAMPTZ DEFAULT NOW(),
     *   started_at TIMESTAMPTZ,
     *   completed_at TIMESTAMPTZ
     * );
     */

    it('should have correct table name', () => {
      const tables = getMetadataArgsStorage().tables;
      const table = tables.find((t) => t.target === GeneratedReport);

      expect(table?.name).toBe('generated_reports');
    });

    it('should have all columns from database schema', () => {
      const expectedColumns = [
        'id',
        'test_run_id',
        'template_id',
        'name',
        'generated_by',
        'html_content',
        'html_generated_at',
        'share_id',
        'share_enabled',
        'share_view_count',
        'last_shared_at',
        'pdf_data',
        'file_path',
        'file_size',
        'mime_type',
        'file_metadata',
        'status',
        'error_code',
        'error_message',
        'job_id',
        'retry_count',
        'max_retries',
        'download_count',
        'last_downloaded_at',
        'expires_at',
        'created_at',
        'updated_at',
        'started_at',
        'completed_at',
      ];

      const columns = getMetadataArgsStorage().columns;
      const entityColumns = columns.filter(
        (c) => c.target === GeneratedReport
      );
      const columnNames = entityColumns.map((c) => c.propertyName);

      expectedColumns.forEach((col) => {
        expect(columnNames).toContain(col);
      });
    });

    it('should have all required NOT NULL columns', () => {
      const columns = getMetadataArgsStorage().columns;
      const entityColumns = columns.filter(
        (c) => c.target === GeneratedReport
      );

      // These columns should NOT be nullable
      const requiredColumns = [
        'test_run_id',
        'template_id',
        'name',
        'generated_by',
      ];

      requiredColumns.forEach((colName) => {
        const column = entityColumns.find((c) => c.propertyName === colName);
        expect(column?.options?.nullable).not.toBe(true);
      });
    });

    it('should have all nullable columns correctly marked', () => {
      const columns = getMetadataArgsStorage().columns;
      const entityColumns = columns.filter(
        (c) => c.target === GeneratedReport
      );

      const nullableColumns = [
        'html_content',
        'html_generated_at',
        'last_shared_at',
        'pdf_data',
        'file_path',
        'file_size',
        'file_metadata',
        'error_code',
        'error_message',
        'job_id',
        'last_downloaded_at',
        'expires_at',
        'started_at',
        'completed_at',
      ];

      nullableColumns.forEach((colName) => {
        const column = entityColumns.find((c) => c.propertyName === colName);
        expect(column?.options?.nullable).toBe(true);
      });
    });

    it('should have correct default values', () => {
      const columns = getMetadataArgsStorage().columns;
      const entityColumns = columns.filter(
        (c) => c.target === GeneratedReport
      );

      // share_enabled default: false
      const shareEnabledCol = entityColumns.find(
        (c) => c.propertyName === 'share_enabled'
      );
      expect(shareEnabledCol?.options?.default).toBe(false);

      // share_view_count default: 0
      const viewCountCol = entityColumns.find(
        (c) => c.propertyName === 'share_view_count'
      );
      expect(viewCountCol?.options?.default).toBe(0);

      // mime_type default: 'application/pdf'
      const mimeTypeCol = entityColumns.find(
        (c) => c.propertyName === 'mime_type'
      );
      expect(mimeTypeCol?.options?.default).toBe('application/pdf');

      // status default: 'pending'
      const statusCol = entityColumns.find(
        (c) => c.propertyName === 'status'
      );
      expect(statusCol?.options?.default).toBe('pending');

      // retry_count default: 0
      const retryCountCol = entityColumns.find(
        (c) => c.propertyName === 'retry_count'
      );
      expect(retryCountCol?.options?.default).toBe(0);

      // max_retries default: 3
      const maxRetriesCol = entityColumns.find(
        (c) => c.propertyName === 'max_retries'
      );
      expect(maxRetriesCol?.options?.default).toBe(3);

      // download_count default: 0
      const downloadCountCol = entityColumns.find(
        (c) => c.propertyName === 'download_count'
      );
      expect(downloadCountCol?.options?.default).toBe(0);
    });
  });
});
