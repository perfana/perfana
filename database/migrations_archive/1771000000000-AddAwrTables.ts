import { MigrationInterface, QueryRunner, Table, TableIndex, TableForeignKey } from 'typeorm';

/**
 * Migration to add AWR (Automatic Workload Repository) tables
 * - awr_reports: Stores Oracle AWR report files and parsed data
 * - awr_analysis: Stores analysis results and insights from AWR reports
 */
export class AddAwrTables1771000000000 implements MigrationInterface {
  name = 'AddAwrTables1771000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ==================== Create awr_reports table ====================
    await queryRunner.createTable(
      new Table({
        name: 'awr_reports',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          // Foreign Key
          {
            name: 'test_run_id',
            type: 'uuid',
            isNullable: false,
          },
          // File Metadata
          {
            name: 'file_name',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          {
            name: 'file_size',
            type: 'integer',
            isNullable: false,
          },
          {
            name: 'file_type',
            type: 'varchar',
            length: '10',
            default: "'html'",
            isNullable: false,
          },
          {
            name: 'raw_content',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'raw_content_url',
            type: 'varchar',
            length: '500',
            isNullable: true,
          },
          // Database Metadata
          {
            name: 'db_name',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'db_id',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'instance_name',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'db_edition',
            type: 'varchar',
            length: '50',
            isNullable: true,
          },
          {
            name: 'db_release',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
          {
            name: 'is_rac',
            type: 'boolean',
            isNullable: true,
          },
          {
            name: 'is_cdb',
            type: 'boolean',
            isNullable: true,
          },
          // Host Information
          {
            name: 'host_name',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'platform',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'cpus',
            type: 'integer',
            isNullable: true,
          },
          {
            name: 'cores',
            type: 'integer',
            isNullable: true,
          },
          {
            name: 'sockets',
            type: 'integer',
            isNullable: true,
          },
          {
            name: 'memory_gb',
            type: 'decimal',
            precision: 10,
            scale: 2,
            isNullable: true,
          },
          // Snapshot Information
          {
            name: 'snap_id_begin',
            type: 'integer',
            isNullable: true,
          },
          {
            name: 'snap_id_end',
            type: 'integer',
            isNullable: true,
          },
          {
            name: 'begin_time',
            type: 'timestamp with time zone',
            isNullable: true,
          },
          {
            name: 'end_time',
            type: 'timestamp with time zone',
            isNullable: true,
          },
          {
            name: 'elapsed_minutes',
            type: 'decimal',
            precision: 10,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'db_time_minutes',
            type: 'decimal',
            precision: 10,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'sessions_begin',
            type: 'integer',
            isNullable: true,
          },
          {
            name: 'sessions_end',
            type: 'integer',
            isNullable: true,
          },
          // Parsed Data (JSONB)
          {
            name: 'parsed_data',
            type: 'jsonb',
            isNullable: true,
          },
          // Upload & Parse Status
          {
            name: 'uploaded_at',
            type: 'timestamp with time zone',
            default: 'now()',
            isNullable: false,
          },
          {
            name: 'uploaded_by',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          {
            name: 'parsed_at',
            type: 'timestamp with time zone',
            isNullable: true,
          },
          {
            name: 'parse_status',
            type: 'varchar',
            length: '20',
            default: "'pending'",
            isNullable: false,
          },
          {
            name: 'parse_error',
            type: 'text',
            isNullable: true,
          },
        ],
      }),
      true,
    );

    // Create indexes for awr_reports
    await queryRunner.createIndex(
      'awr_reports',
      new TableIndex({
        name: 'idx_awr_reports_test_run_id',
        columnNames: ['test_run_id'],
      }),
    );

    await queryRunner.createIndex(
      'awr_reports',
      new TableIndex({
        name: 'idx_awr_reports_parse_status',
        columnNames: ['parse_status'],
      }),
    );

    await queryRunner.createIndex(
      'awr_reports',
      new TableIndex({
        name: 'idx_awr_reports_uploaded_at',
        columnNames: ['uploaded_at'],
      }),
    );

    await queryRunner.createIndex(
      'awr_reports',
      new TableIndex({
        name: 'idx_awr_reports_db_name',
        columnNames: ['db_name'],
      }),
    );

    // Add foreign key constraint to test_runs
    await queryRunner.createForeignKey(
      'awr_reports',
      new TableForeignKey({
        name: 'fk_awr_reports_test_run',
        columnNames: ['test_run_id'],
        referencedTableName: 'test_runs',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    // ==================== Create awr_analysis table ====================
    await queryRunner.createTable(
      new Table({
        name: 'awr_analysis',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          // Foreign Keys
          {
            name: 'awr_report_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'baseline_report_id',
            type: 'uuid',
            isNullable: true,
          },
          // Analysis Metadata
          {
            name: 'analysis_type',
            type: 'varchar',
            length: '20',
            default: "'single'",
            isNullable: false,
          },
          {
            name: 'analysis_version',
            type: 'varchar',
            length: '50',
            isNullable: true,
          },
          // Analysis Results (JSONB)
          {
            name: 'insights',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'severity_summary',
            type: 'jsonb',
            isNullable: true,
          },
          // Timestamps
          {
            name: 'analyzed_at',
            type: 'timestamp with time zone',
            default: 'now()',
            isNullable: false,
          },
        ],
      }),
      true,
    );

    // Create indexes for awr_analysis
    await queryRunner.createIndex(
      'awr_analysis',
      new TableIndex({
        name: 'idx_awr_analysis_awr_report_id',
        columnNames: ['awr_report_id'],
      }),
    );

    await queryRunner.createIndex(
      'awr_analysis',
      new TableIndex({
        name: 'idx_awr_analysis_analysis_type',
        columnNames: ['analysis_type'],
      }),
    );

    await queryRunner.createIndex(
      'awr_analysis',
      new TableIndex({
        name: 'idx_awr_analysis_baseline_report_id',
        columnNames: ['baseline_report_id'],
      }),
    );

    await queryRunner.createIndex(
      'awr_analysis',
      new TableIndex({
        name: 'idx_awr_analysis_analyzed_at',
        columnNames: ['analyzed_at'],
      }),
    );

    // Add foreign key constraints
    await queryRunner.createForeignKey(
      'awr_analysis',
      new TableForeignKey({
        name: 'fk_awr_analysis_awr_report',
        columnNames: ['awr_report_id'],
        referencedTableName: 'awr_reports',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'awr_analysis',
      new TableForeignKey({
        name: 'fk_awr_analysis_baseline_report',
        columnNames: ['baseline_report_id'],
        referencedTableName: 'awr_reports',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop foreign keys first
    await queryRunner.dropForeignKey('awr_analysis', 'fk_awr_analysis_baseline_report');
    await queryRunner.dropForeignKey('awr_analysis', 'fk_awr_analysis_awr_report');
    await queryRunner.dropForeignKey('awr_reports', 'fk_awr_reports_test_run');

    // Drop tables (indexes are dropped automatically)
    await queryRunner.dropTable('awr_analysis');
    await queryRunner.dropTable('awr_reports');
  }
}
