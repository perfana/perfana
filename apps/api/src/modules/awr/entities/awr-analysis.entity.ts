import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { AwrReport } from './awr-report.entity';

/**
 * Analysis type enum for AWR analysis
 * - single: Analysis of a single AWR report
 * - comparison: Comparison analysis between two AWR reports
 */
export type AnalysisType = 'single' | 'comparison';

/**
 * Severity levels for AWR insights
 */
export type InsightSeverity = 'critical' | 'warning' | 'info';

/**
 * Insight category types for grouping insights
 */
export type InsightCategory =
  | 'sql_performance'
  | 'wait_events'
  | 'resource_utilization'
  | 'io_performance'
  | 'memory'
  | 'memory_efficiency'
  | 'lock_contention'
  | 'parse_overhead'
  | 'network'
  | 'configuration'
  | 'regression'
  | 'improvement';

/**
 * Individual insight generated from AWR analysis
 */
export interface AwrInsight {
  /** Unique identifier for the insight */
  id: string;
  /** Severity level of the insight */
  severity: InsightSeverity;
  /** Category of the insight for grouping */
  category: InsightCategory;
  /** Short title describing the insight */
  title: string;
  /** Detailed description of the insight */
  description: string;
  /** Recommendation for addressing the issue */
  recommendation?: string;
  /** Related SQL ID if applicable */
  sqlId?: string;
  /** Related wait event if applicable */
  waitEvent?: string;
  /** Numeric value associated with the insight (e.g., percentage, time) */
  value?: number;
  /** Unit for the numeric value */
  unit?: string;
  /** Threshold that was exceeded */
  threshold?: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Summary of insights by severity level
 */
export interface SeveritySummary {
  /** Number of critical severity insights */
  critical: number;
  /** Number of warning severity insights */
  warning: number;
  /** Number of info severity insights */
  info: number;
  /** Total number of insights */
  total: number;
}

/**
 * AWR Analysis entity for storing analysis results and insights
 *
 * Stores the results of analyzing AWR reports, including generated insights
 * and severity summaries. Supports both single report analysis and comparison
 * analysis between two reports.
 *
 * @example
 * const analysis = new AwrAnalysis();
 * analysis.awrReportId = awrReport.id;
 * analysis.analysisType = 'single';
 * analysis.insights = [{ id: '1', severity: 'warning', ... }];
 */
@Entity('awr_analysis')
@Index('idx_awr_analysis_awr_report_id', ['awrReportId'])
@Index('idx_awr_analysis_analysis_type', ['analysisType'])
@Index('idx_awr_analysis_baseline_report_id', ['baselineReportId'])
@Index('idx_awr_analysis_analyzed_at', ['analyzedAt'])
export class AwrAnalysis {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // ==================== Foreign Keys ====================

  @Column({ name: 'awr_report_id', type: 'uuid' })
  awrReportId!: string;

  @Column({ name: 'baseline_report_id', type: 'uuid', nullable: true })
  baselineReportId?: string;

  // ==================== Analysis Metadata ====================

  @Column({
    name: 'analysis_type',
    type: 'varchar',
    length: 20,
    default: 'single',
  })
  analysisType!: AnalysisType;

  @Column({ name: 'analysis_version', type: 'varchar', length: 50, nullable: true })
  analysisVersion?: string;

  // ==================== Analysis Results (JSONB) ====================

  @Column('jsonb', { nullable: true })
  insights?: AwrInsight[];

  @Column('jsonb', { name: 'severity_summary', nullable: true })
  severitySummary?: SeveritySummary;

  // ==================== Ownership Tracking ====================

  @Column({ type: 'uuid', nullable: true, name: 'organization_id' })
  organizationId?: string;

  @Column({ type: 'uuid', nullable: true, name: 'team_id' })
  teamId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'created_by' })
  createdBy?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'updated_by' })
  updatedBy?: string;

  // ==================== Timestamps ====================

  @CreateDateColumn({ name: 'analyzed_at', type: 'timestamp with time zone', default: () => 'now()' })
  analyzedAt!: Date;

  // ==================== Relationships ====================

  @ManyToOne(() => AwrReport, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'awr_report_id' })
  awrReport?: AwrReport;

  @ManyToOne(() => AwrReport, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'baseline_report_id' })
  baselineReport?: AwrReport;
}
