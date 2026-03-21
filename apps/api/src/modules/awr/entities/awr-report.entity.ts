import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { TestRun } from '../../../entities';

/**
 * Parse status enum for AWR report processing state
 */
export type ParseStatus = 'pending' | 'parsing' | 'completed' | 'failed';

/**
 * File type enum for AWR report format
 */
export type FileType = 'html' | 'text';

/**
 * Parsed AWR data structure stored as JSONB
 * Contains extracted sections from the AWR report
 */
export interface ParsedAwrData {
  /** Load profile metrics (per second and per transaction) */
  loadProfile?: Record<string, unknown>;
  /** Time model statistics */
  timeModel?: Record<string, unknown>;
  /** Top SQL statements by various metrics */
  topSql?: Record<string, unknown>;
  /** Wait events and their statistics */
  waitEvents?: Record<string, unknown>;
  /** Instance configuration parameters */
  instanceConfig?: Record<string, unknown>;
  /** Operating system statistics */
  osStatistics?: Record<string, unknown>;
  /** I/O statistics by tablespace/file */
  ioStatistics?: Record<string, unknown>;
  /** Memory statistics (SGA, PGA) */
  memoryStatistics?: Record<string, unknown>;
  /** Additional parsed sections */
  [key: string]: unknown;
}

/**
 * AWR Report entity for storing Oracle Automatic Workload Repository reports
 *
 * Stores both raw file content and parsed data extracted from AWR HTML reports.
 * Supports async parsing via BullMQ with status tracking.
 *
 * @example
 * const awrReport = new AwrReport();
 * awrReport.testRunId = testRun.id;
 * awrReport.fileName = 'awrrpt_1_100_101.html';
 * awrReport.fileSize = 524288;
 * awrReport.parseStatus = 'pending';
 */
@Entity('awr_reports')
@Index('idx_awr_reports_test_run_id', ['testRunId'])
@Index('idx_awr_reports_parse_status', ['parseStatus'])
@Index('idx_awr_reports_uploaded_at', ['uploadedAt'])
@Index('idx_awr_reports_db_name', ['dbName'])
export class AwrReport {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // ==================== Foreign Key ====================

  @Column({ name: 'test_run_id', type: 'uuid' })
  testRunId!: string;

  // ==================== File Metadata ====================

  @Column({ name: 'file_name', type: 'varchar', length: 255 })
  fileName!: string;

  @Column({ name: 'file_size', type: 'integer' })
  fileSize!: number;

  @Column({
    name: 'file_type',
    type: 'varchar',
    length: 10,
    default: 'html',
  })
  fileType!: FileType;

  @Column({ name: 'raw_content', type: 'text', nullable: true })
  rawContent?: string;

  @Column({ name: 'raw_content_url', type: 'varchar', length: 500, nullable: true })
  rawContentUrl?: string;

  // ==================== Database Metadata ====================

  @Column({ name: 'db_name', type: 'varchar', length: 255, nullable: true })
  dbName?: string;

  @Column({ name: 'db_id', type: 'varchar', length: 255, nullable: true })
  dbId?: string;

  @Column({ name: 'instance_name', type: 'varchar', length: 255, nullable: true })
  instanceName?: string;

  @Column({ name: 'db_edition', type: 'varchar', length: 50, nullable: true })
  dbEdition?: string;

  @Column({ name: 'db_release', type: 'varchar', length: 100, nullable: true })
  dbRelease?: string;

  @Column({ name: 'is_rac', type: 'boolean', nullable: true })
  isRac?: boolean;

  @Column({ name: 'is_cdb', type: 'boolean', nullable: true })
  isCdb?: boolean;

  // ==================== Host Information ====================

  @Column({ name: 'host_name', type: 'varchar', length: 255, nullable: true })
  hostName?: string;

  @Column({ name: 'platform', type: 'varchar', length: 255, nullable: true })
  platform?: string;

  @Column({ type: 'integer', nullable: true })
  cpus?: number;

  @Column({ type: 'integer', nullable: true })
  cores?: number;

  @Column({ type: 'integer', nullable: true })
  sockets?: number;

  @Column({ name: 'memory_gb', type: 'decimal', precision: 10, scale: 2, nullable: true })
  memoryGb?: number;

  // ==================== Snapshot Information ====================

  @Column({ name: 'snap_id_begin', type: 'integer', nullable: true })
  snapIdBegin?: number;

  @Column({ name: 'snap_id_end', type: 'integer', nullable: true })
  snapIdEnd?: number;

  @Column({ name: 'begin_time', type: 'timestamp with time zone', nullable: true })
  beginTime?: Date;

  @Column({ name: 'end_time', type: 'timestamp with time zone', nullable: true })
  endTime?: Date;

  @Column({ name: 'elapsed_minutes', type: 'decimal', precision: 10, scale: 2, nullable: true })
  elapsedMinutes?: number;

  @Column({ name: 'db_time_minutes', type: 'decimal', precision: 10, scale: 2, nullable: true })
  dbTimeMinutes?: number;

  @Column({ name: 'sessions_begin', type: 'integer', nullable: true })
  sessionsBegin?: number;

  @Column({ name: 'sessions_end', type: 'integer', nullable: true })
  sessionsEnd?: number;

  // ==================== Parsed Data (JSONB) ====================

  @Column('jsonb', { name: 'parsed_data', nullable: true })
  parsedData?: ParsedAwrData;

  // ==================== Ownership Tracking ====================

  @Column({ type: 'uuid', nullable: true, name: 'organization_id' })
  organizationId?: string;

  @Column({ type: 'uuid', nullable: true, name: 'team_id' })
  teamId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'created_by' })
  createdBy?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'updated_by' })
  updatedBy?: string;

  // ==================== Upload & Parse Status ====================

  @CreateDateColumn({ name: 'uploaded_at', type: 'timestamp with time zone', default: () => 'now()' })
  uploadedAt!: Date;

  @Column({ name: 'uploaded_by', type: 'varchar', length: 255 })
  uploadedBy!: string;

  @Column({ name: 'parsed_at', type: 'timestamp with time zone', nullable: true })
  parsedAt?: Date;

  @Column({
    name: 'parse_status',
    type: 'varchar',
    length: 20,
    default: 'pending',
  })
  parseStatus!: ParseStatus;

  @Column({ name: 'parse_error', type: 'text', nullable: true })
  parseError?: string;

  // ==================== Relationships ====================

  @ManyToOne(() => TestRun, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'test_run_id' })
  testRun?: TestRun;
}
