import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
} from 'typeorm';

/**
 * Report section types supported by the reporting system.
 * Uses underscores (not hyphens) as per project conventions.
 */
export type ReportSectionType =
  | 'header'
  | 'text_block'
  | 'slo'
  | 'apdex'
  | 'transaction_response_times'
  | 'regressions'
  | 'awr'
  | 'trends'
  | 'comparisons'
  | 'graphs';

/**
 * Configuration for a report section.
 * Each section type has specific configuration options.
 */
export interface ReportSectionConfig {
  /** Section type identifier */
  type: ReportSectionType;
  /** Display order in the report */
  order: number;
  /** Section title override (optional) */
  title?: string;
  /** Section-specific configuration */
  config?: Record<string, unknown>;
  /** Optional comment for stakeholder communication (not available for header/text_block) */
  comment?: string;
}

/**
 * Styling configuration for report templates.
 */
export interface ReportStyling {
  /** Primary color for the report */
  primaryColor?: string;
  /** Secondary color for the report */
  secondaryColor?: string;
  /** Logo URL or base64 encoded image */
  logo?: string;
  /** Font family for the report */
  fontFamily?: string;
  /** Custom CSS to inject */
  customCss?: string;
}

/**
 * ReportTemplate entity matching the existing report_templates table.
 *
 * Templates define reusable report configurations that can be applied
 * to test runs. Templates are scoped by system_id/test_environment/workload
 * rather than organization_id.
 */
@Entity('report_templates')
@Unique('uq_report_templates_name_scope', [
  'name',
  'system_id',
  'test_environment',
  'workload',
])
export class ReportTemplate {
  // Phase 5a — full-CRUD audit on user-curated template config. `is_adhoc`
  // flips to true for ephemeral one-shot adhoc reports; the diff makes those
  // rows filterable. organizationId/teamId are emitted via dedicated
  // audit_logs columns; created_by/updated_by are the actor (also redundant).
  static auditableFields = [
    'name',
    'description',
    'system_id',
    'test_environment',
    'workload',
    'sections',
    'styling',
    'is_default',
    'is_adhoc',
    'teamId',
  ] as const;

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  // Ownership tracking (RBAC Phase 2)
  @Column({ type: 'uuid', name: 'organization_id' })
  organizationId!: string;

  @Column({ type: 'uuid', nullable: true, name: 'team_id' })
  teamId?: string;

  @Column({ type: 'varchar', length: 255 })
  created_by!: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'updated_by' })
  updatedBy?: string;

  @Column({ type: 'varchar', length: 255 })
  system_id!: string;

  @Column({ type: 'varchar', length: 255 })
  test_environment!: string;

  @Column({ type: 'varchar', length: 255 })
  workload!: string;

  @Column({ type: 'jsonb', default: '[]' })
  sections!: ReportSectionConfig[];

  @Column({ type: 'jsonb', nullable: true })
  styling?: ReportStyling;

  @Column({ type: 'boolean', default: false })
  is_default!: boolean;

  @Column({ type: 'boolean', default: false })
  is_adhoc!: boolean;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
