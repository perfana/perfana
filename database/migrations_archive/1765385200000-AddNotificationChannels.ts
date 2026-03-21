import { MigrationInterface, QueryRunner, Table, TableIndex, TableForeignKey } from 'typeorm';

/**
 * Migration to add notification_channels table for Slack/Teams notifications
 */
export class AddNotificationChannels1765385200000 implements MigrationInterface {
  name = 'AddNotificationChannels1765385200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create the notification_channels table
    await queryRunner.createTable(
      new Table({
        name: 'notification_channels',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'system_under_test_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'type',
            type: 'varchar',
            length: '20',
            isNullable: false,
          },
          {
            name: 'name',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          {
            name: 'webhook_url',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'notify_on_finished',
            type: 'boolean',
            default: true,
          },
          {
            name: 'notify_on_failed_only',
            type: 'boolean',
            default: false,
          },
          {
            name: 'enabled',
            type: 'boolean',
            default: true,
          },
          {
            name: 'created_at',
            type: 'timestamp with time zone',
            default: 'now()',
          },
          {
            name: 'updated_at',
            type: 'timestamp with time zone',
            default: 'now()',
          },
        ],
      }),
      true,
    );

    // Create unique constraint on system_under_test_id + name
    await queryRunner.createIndex(
      'notification_channels',
      new TableIndex({
        name: 'uq_notification_channels_system_name',
        columnNames: ['system_under_test_id', 'name'],
        isUnique: true,
      }),
    );

    // Create index on system_under_test_id for lookups
    await queryRunner.createIndex(
      'notification_channels',
      new TableIndex({
        name: 'idx_notification_channels_system_id',
        columnNames: ['system_under_test_id'],
      }),
    );

    // Create index on enabled for filtering
    await queryRunner.createIndex(
      'notification_channels',
      new TableIndex({
        name: 'idx_notification_channels_enabled',
        columnNames: ['enabled'],
      }),
    );

    // Add foreign key constraint to systems_under_test
    await queryRunner.createForeignKey(
      'notification_channels',
      new TableForeignKey({
        name: 'fk_notification_channels_system_under_test',
        columnNames: ['system_under_test_id'],
        referencedTableName: 'systems_under_test',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop foreign key first
    await queryRunner.dropForeignKey(
      'notification_channels',
      'fk_notification_channels_system_under_test',
    );

    // Drop the table (indexes are dropped automatically)
    await queryRunner.dropTable('notification_channels');
  }
}
