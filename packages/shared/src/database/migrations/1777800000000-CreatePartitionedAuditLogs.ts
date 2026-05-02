import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePartitionedAuditLogs1777800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Greenfield: drop the existing non-partitioned table. Phase 5a starts a new lineage.
    // Existing rows are scaffolding-era artefacts from the legacy AuditInterceptor (now deleted).
    await queryRunner.query(`DROP TABLE IF EXISTS audit_logs CASCADE`);

    await queryRunner.query(`
      CREATE TABLE audit_logs (
        id              uuid           NOT NULL DEFAULT gen_random_uuid(),
        timestamp       timestamptz    NOT NULL DEFAULT now(),
        user_id         varchar(255)   NOT NULL,
        user_email      varchar(255),
        organization_id uuid,
        action          varchar(20)    NOT NULL,
        resource_type   varchar(100)   NOT NULL,
        resource_id     varchar(255),
        resource_name   varchar(255),
        changes         jsonb,
        metadata        jsonb,
        success         boolean        NOT NULL DEFAULT true,
        error_message   text,
        ip_address      varchar(45),
        user_agent      text,
        PRIMARY KEY (id, timestamp)
      ) PARTITION BY RANGE (timestamp)
    `);

    await queryRunner.query(
      `CREATE INDEX idx_audit_logs_timestamp ON audit_logs (timestamp DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_audit_logs_user_id ON audit_logs (user_id, timestamp DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_audit_logs_organization_id ON audit_logs (organization_id, timestamp DESC) WHERE organization_id IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_audit_logs_resource ON audit_logs (resource_type, resource_id, timestamp DESC) WHERE resource_id IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_audit_logs_action ON audit_logs (action, timestamp DESC)`,
    );

    // Bootstrap: current month + next two months of partitions.
    const now = new Date();
    for (let offset = 0; offset < 3; offset++) {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
      const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
      const part = `audit_logs_${start.getUTCFullYear()}_${String(start.getUTCMonth() + 1).padStart(2, '0')}`;
      await queryRunner.query(
        `CREATE TABLE ${part} PARTITION OF audit_logs FOR VALUES FROM ('${start.toISOString()}') TO ('${end.toISOString()}')`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Down restores the prior non-partitioned table; data lost is acceptable per greenfield contract.
    await queryRunner.query(`DROP TABLE IF EXISTS audit_logs CASCADE`);
    await queryRunner.query(`
      CREATE TABLE audit_logs (
        id              uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
        timestamp       timestamptz    NOT NULL DEFAULT now(),
        user_id         varchar(255)   NOT NULL,
        user_email      varchar(255),
        organization_id uuid,
        action          varchar(50)    NOT NULL,
        resource_type   varchar(100)   NOT NULL,
        resource_id     varchar(255),
        resource_name   varchar(255),
        changes         jsonb,
        metadata        jsonb,
        success         boolean        NOT NULL DEFAULT true,
        error_message   text,
        ip_address      varchar(45),
        user_agent      text
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_audit_logs_timestamp ON audit_logs (timestamp)`);
    await queryRunner.query(`CREATE INDEX idx_audit_logs_user_id ON audit_logs (user_id)`);
    await queryRunner.query(`CREATE INDEX idx_audit_logs_organization_id ON audit_logs (organization_id)`);
    await queryRunner.query(`CREATE INDEX idx_audit_logs_resource ON audit_logs (resource_type, resource_id)`);
    await queryRunner.query(`CREATE INDEX idx_audit_logs_action ON audit_logs (action)`);
  }
}
