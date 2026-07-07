import { MigrationInterface, QueryRunner } from "typeorm";

export class AddProxyServer1783409734007 implements MigrationInterface {
    name = 'AddProxyServer1783409734007'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Idempotent: the consolidated greenfield migration (1700000000000) already creates
        // proxy_servers + use_proxy on fresh DBs. This standalone migration exists for EXISTING
        // DBs (where the consolidated migration is already recorded and won't re-run). IF NOT EXISTS
        // keeps it safe when both run in sequence on greenfield (avoids 42P07 relation-exists crash).
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "proxy_servers" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid NOT NULL, "proxy_url" text NOT NULL, "username" text, "password" text, "team_id" uuid, "created_by" character varying(255), "updated_by" character varying(255), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "uq_proxy_servers_organization" UNIQUE ("organization_id"), CONSTRAINT "PK_8708f2b15e69d2466115a372443" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "proxy_servers" ENABLE ROW LEVEL SECURITY`);
        await queryRunner.query(`ALTER TABLE "proxy_servers" FORCE ROW LEVEL SECURITY`);
        await queryRunner.query(`DROP POLICY IF EXISTS rls_proxy_servers_select ON public.proxy_servers`);
        await queryRunner.query(`CREATE POLICY rls_proxy_servers_select ON public.proxy_servers FOR SELECT USING (public.can_access_resource(organization_id, team_id, (created_by)::text))`);
        await queryRunner.query(`DROP POLICY IF EXISTS rls_proxy_servers_insert ON public.proxy_servers`);
        await queryRunner.query(`CREATE POLICY rls_proxy_servers_insert ON public.proxy_servers FOR INSERT WITH CHECK (true)`);
        await queryRunner.query(`DROP POLICY IF EXISTS rls_proxy_servers_update ON public.proxy_servers`);
        await queryRunner.query(`CREATE POLICY rls_proxy_servers_update ON public.proxy_servers FOR UPDATE USING (public.can_modify_resource(organization_id, team_id, (created_by)::text))`);
        await queryRunner.query(`DROP POLICY IF EXISTS rls_proxy_servers_delete ON public.proxy_servers`);
        await queryRunner.query(`CREATE POLICY rls_proxy_servers_delete ON public.proxy_servers FOR DELETE USING (public.can_modify_resource(organization_id, team_id, (created_by)::text))`);
        await queryRunner.query(`ALTER TABLE "grafana_instances" ADD COLUMN IF NOT EXISTS "use_proxy" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "dynatrace_configs" ADD COLUMN IF NOT EXISTS "use_proxy" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "pyroscope_instances" ADD COLUMN IF NOT EXISTS "use_proxy" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "tracing_instances" ADD COLUMN IF NOT EXISTS "use_proxy" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "notification_channels" ADD COLUMN IF NOT EXISTS "use_proxy" boolean NOT NULL DEFAULT false`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "notification_channels" DROP COLUMN IF EXISTS "use_proxy"`);
        await queryRunner.query(`ALTER TABLE "tracing_instances" DROP COLUMN IF EXISTS "use_proxy"`);
        await queryRunner.query(`ALTER TABLE "pyroscope_instances" DROP COLUMN IF EXISTS "use_proxy"`);
        await queryRunner.query(`ALTER TABLE "dynatrace_configs" DROP COLUMN IF EXISTS "use_proxy"`);
        await queryRunner.query(`ALTER TABLE "grafana_instances" DROP COLUMN IF EXISTS "use_proxy"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "proxy_servers"`);
    }

}
