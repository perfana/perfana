import { MigrationInterface, QueryRunner, Table, TableIndex, TableForeignKey } from 'typeorm';

/**
 * Migration to add report generation and template tables
 * - report_templates: Reusable report configurations scoped by system/environment/workload
 * - generated_reports: Report instances with HTML content and optional PDF generation
 */
export class AddGeneratedReportsAndTemplates1773000000000 implements MigrationInterface {
  name = 'AddGeneratedReportsAndTemplates1773000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ==================== Create report_templates table ====================
    await queryRunner.createTable(
      new Table({
        name: 'report_templates',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'name',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          {
            name: 'description',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'created_by',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          {
            name: 'system_id',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          {
            name: 'test_environment',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          {
            name: 'workload',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          {
            name: 'sections',
            type: 'jsonb',
            default: "'[]'",
            isNullable: false,
          },
          {
            name: 'styling',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'is_default',
            type: 'boolean',
            default: false,
            isNullable: false,
          },
          {
            name: 'is_adhoc',
            type: 'boolean',
            default: false,
            isNullable: false,
          },
          {
            name: 'created_at',
            type: 'timestamp with time zone',
            default: 'now()',
            isNullable: false,
          },
          {
            name: 'updated_at',
            type: 'timestamp with time zone',
            default: 'now()',
            isNullable: false,
          },
        ],
      }),
      true,
    );

    // Create unique constraint for name scoped by system/environment/workload
    await queryRunner.createIndex(
      'report_templates',
      new TableIndex({
        name: 'uq_report_templates_name_scope',
        columnNames: ['name', 'system_id', 'test_environment', 'workload'],
        isUnique: true,
      }),
    );

    // ==================== Create generated_reports table ====================
    await queryRunner.createTable(
      new Table({
        name: 'generated_reports',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'test_run_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'template_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'name',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          {
            name: 'generated_by',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          // HTML Content Fields
          {
            name: 'html_content',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'html_generated_at',
            type: 'timestamp with time zone',
            isNullable: true,
          },
          // Share Fields
          {
            name: 'share_id',
            type: 'uuid',
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
            isUnique: true,
            isNullable: false,
          },
          {
            name: 'share_enabled',
            type: 'boolean',
            default: false,
            isNullable: false,
          },
          {
            name: 'share_view_count',
            type: 'integer',
            default: 0,
            isNullable: false,
          },
          {
            name: 'last_shared_at',
            type: 'timestamp with time zone',
            isNullable: true,
          },
          // PDF Storage Fields
          {
            name: 'file_path',
            type: 'varchar',
            length: '1024',
            isNullable: true,
          },
          {
            name: 'file_size',
            type: 'bigint',
            isNullable: true,
          },
          {
            name: 'mime_type',
            type: 'varchar',
            length: '100',
            default: "'application/pdf'",
            isNullable: false,
          },
          {
            name: 'file_metadata',
            type: 'jsonb',
            isNullable: true,
          },
          // Status & Error Fields
          {
            name: 'status',
            type: 'varchar',
            length: '20',
            default: "'pending'",
            isNullable: false,
          },
          {
            name: 'error_code',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
          {
            name: 'error_message',
            type: 'text',
            isNullable: true,
          },
          // Job Processing Fields
          {
            name: 'job_id',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
          {
            name: 'retry_count',
            type: 'integer',
            default: 0,
            isNullable: false,
          },
          {
            name: 'max_retries',
            type: 'integer',
            default: 3,
            isNullable: false,
          },
          // Download Tracking Fields
          {
            name: 'download_count',
            type: 'integer',
            default: 0,
            isNullable: false,
          },
          {
            name: 'last_downloaded_at',
            type: 'timestamp with time zone',
            isNullable: true,
          },
          // Expiration & Timestamps
          {
            name: 'expires_at',
            type: 'timestamp with time zone',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp with time zone',
            default: 'now()',
            isNullable: false,
          },
          {
            name: 'updated_at',
            type: 'timestamp with time zone',
            default: 'now()',
            isNullable: false,
          },
          {
            name: 'started_at',
            type: 'timestamp with time zone',
            isNullable: true,
          },
          {
            name: 'completed_at',
            type: 'timestamp with time zone',
            isNullable: true,
          },
        ],
      }),
      true,
    );

    // Create indexes for generated_reports
    await queryRunner.createIndex(
      'generated_reports',
      new TableIndex({
        name: 'idx_generated_reports_test_run_id',
        columnNames: ['test_run_id'],
      }),
    );

    await queryRunner.createIndex(
      'generated_reports',
      new TableIndex({
        name: 'idx_generated_reports_template_id',
        columnNames: ['template_id'],
      }),
    );

    await queryRunner.createIndex(
      'generated_reports',
      new TableIndex({
        name: 'idx_generated_reports_share_id',
        columnNames: ['share_id'],
        isUnique: true,
      }),
    );

    await queryRunner.createIndex(
      'generated_reports',
      new TableIndex({
        name: 'idx_generated_reports_status',
        columnNames: ['status'],
      }),
    );

    await queryRunner.createIndex(
      'generated_reports',
      new TableIndex({
        name: 'idx_generated_reports_created_at',
        columnNames: ['created_at'],
      }),
    );

    // Add foreign key constraints
    await queryRunner.createForeignKey(
      'generated_reports',
      new TableForeignKey({
        name: 'fk_generated_reports_test_run',
        columnNames: ['test_run_id'],
        referencedTableName: 'test_runs',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'generated_reports',
      new TableForeignKey({
        name: 'fk_generated_reports_template',
        columnNames: ['template_id'],
        referencedTableName: 'report_templates',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop foreign keys first
    await queryRunner.dropForeignKey('generated_reports', 'fk_generated_reports_template');
    await queryRunner.dropForeignKey('generated_reports', 'fk_generated_reports_test_run');

    // Drop tables (indexes are dropped automatically)
    await queryRunner.dropTable('generated_reports');
    await queryRunner.dropTable('report_templates');
  }
}
