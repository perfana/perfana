import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Generated,
} from 'typeorm';
import { TestRun } from './test-run.entity';
import { ReportTemplate } from './report-template.entity';

/**
 * Report generation status values.
 * Status flow: pending → processing → html_complete → (optional) pdf_complete
 */
export type ReportStatus =
  | 'pending'
  | 'processing'
  | 'html_complete'
  | 'pdf_processing'
  | 'pdf_complete'
  | 'failed';

/**
 * Metadata for stored report files (PDF).
 */
export interface ReportFileMetadata {
  /** Original filename */
  filename?: string;
  /** Content hash for integrity verification */
  contentHash?: string;
  /** Generation duration in milliseconds */
  generationDurationMs?: number;
  /** Puppeteer version used for PDF generation */
  puppeteerVersion?: string;
  /** Page count for PDF reports */
  pageCount?: number;
  /** Additional custom metadata */
  [key: string]: unknown;
}

/**
 * GeneratedReport entity matching the existing generated_reports table.
 *
 * Reports are generated from templates and contain HTML content.
 * PDF generation is on-demand via Puppeteer.
 * Reports can be shared publicly via unique share_id UUID.
 */
@Entity('generated_reports')
@Index('idx_generated_reports_test_run_id', ['test_run_id'])
@Index('idx_generated_reports_template_id', ['template_id'])
@Index('idx_generated_reports_share_id', ['share_id'], { unique: true })
@Index('idx_generated_reports_status', ['status'])
@Index('idx_generated_reports_created_at', ['created_at'])
export class GeneratedReport {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  test_run_id!: string;

  @Column({ type: 'uuid' })
  template_id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 255 })
  generated_by!: string;

  // ========================================
  // HTML Content Fields
  // ========================================

  @Column({ type: 'text', nullable: true })
  html_content?: string;

  @Column({ type: 'timestamptz', nullable: true })
  html_generated_at?: Date;

  // ========================================
  // Share Fields
  // ========================================

  @Column({ type: 'uuid', unique: true })
  @Generated('uuid')
  share_id!: string;

  @Column({ type: 'boolean', default: false })
  share_enabled!: boolean;

  @Column({ type: 'integer', default: 0 })
  share_view_count!: number;

  @Column({ type: 'timestamptz', nullable: true })
  last_shared_at?: Date;

  // ========================================
  // PDF Storage Fields
  // ========================================

  @Column({ type: 'varchar', length: 1024, nullable: true })
  file_path?: string;

  @Column({ type: 'bytea', nullable: true })
  pdf_data?: Buffer;

  @Column({ type: 'bigint', nullable: true })
  file_size?: number;

  @Column({ type: 'varchar', length: 100, default: 'application/pdf' })
  mime_type!: string;

  @Column({ type: 'jsonb', nullable: true })
  file_metadata?: ReportFileMetadata;

  // ========================================
  // Status & Error Fields
  // ========================================

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status!: ReportStatus;

  @Column({ type: 'varchar', length: 100, nullable: true })
  error_code?: string;

  @Column({ type: 'text', nullable: true })
  error_message?: string;

  // ========================================
  // Job Processing Fields
  // ========================================

  @Column({ type: 'varchar', length: 100, nullable: true })
  job_id?: string;

  @Column({ type: 'integer', default: 0 })
  retry_count!: number;

  @Column({ type: 'integer', default: 3 })
  max_retries!: number;

  // ========================================
  // Download Tracking Fields
  // ========================================

  @Column({ type: 'integer', default: 0 })
  download_count!: number;

  @Column({ type: 'timestamptz', nullable: true })
  last_downloaded_at?: Date;

  // ========================================
  // Expiration & Timestamps
  // ========================================

  @Column({ type: 'timestamptz', nullable: true })
  expires_at?: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  started_at?: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completed_at?: Date;

  // ========================================
  // Relationships
  // ========================================

  @ManyToOne(() => TestRun, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'test_run_id' })
  test_run?: TestRun;

  @ManyToOne(() => ReportTemplate, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'template_id' })
  template?: ReportTemplate;
}
