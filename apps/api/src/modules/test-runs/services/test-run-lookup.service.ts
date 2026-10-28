/**
 * Test Run Lookup Service
 *
 * Handles finding and creating related entities for test runs:
 * - Systems Under Test
 * - Test Environments
 * - Workloads
 * - Default Team/Organization
 *
 * Extracted from TestRunsMutationService for better separation of concerns.
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { withRequestEm } from '../../../common/db/request-em';
import {
  SystemUnderTest as SystemEntity,
  Team,
} from '../../../entities';
import { DatabaseException } from '../../../common/exceptions/business.exception';
import { SystemUnderTest, TestEnvironment, Workload } from '../types/test-run.types';

@Injectable()
export class TestRunLookupService {
  private readonly logger = new Logger(TestRunLookupService.name);

  constructor(
    @InjectRepository(SystemEntity)
    private readonly systemRepo: Repository<SystemEntity>,
    @InjectRepository(Team)
    private readonly teamRepo: Repository<Team>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Find or create a system under test by name with ownership tracking
   *
   * @param name - System name
   * @param userId - User ID creating the system (for ownership tracking)
   * @param organizationId - Organization ID to assign the system to
   */
  async findOrCreateSystemUnderTest(
    name: string,
    userId: string,
    organizationId: string,
  ): Promise<SystemUnderTest> {
    try {
      const team = await this.getDefaultTeam(organizationId);

      // Atomic upsert: INSERT ON CONFLICT to prevent duplicate systems
      // when concurrent /api/init calls race for the same name+org.
      // The unique index uq_system_under_test_name_org ensures this is safe.
      await this.dataSource.query(
        `INSERT INTO systems_under_test (name, description, team_id, organization_id, created_by, updated_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (name, organization_id) DO NOTHING`,
        [name, name, team?.id ?? null, organizationId, userId, userId],
      );

      // Now read the guaranteed-existing row
      const systemUnderTest = await withRequestEm(this.systemRepo).findOne({
        where: { name, organization_id: organizationId },
        select: ['id', 'name', 'description', 'team_id', 'organization_id', 'created_at', 'updated_at'],
      });

      if (!systemUnderTest) {
        throw new DatabaseException(`Failed to find system under test after upsert: ${name}`);
      }

      return {
        id: systemUnderTest.id,
        name: systemUnderTest.name,
        description: systemUnderTest.description,
        team_id: systemUnderTest.team_id,
        created_at: systemUnderTest.created_at.toISOString(),
        updated_at: systemUnderTest.updated_at.toISOString(),
      };
    } catch (error) {
      this.logger.error(`Failed to find or create system under test: ${name}`, error);
      throw error;
    }
  }

  /**
   * Find or create a test environment for a system
   */
  async findOrCreateTestEnvironment(systemUnderTestId: string, name: string): Promise<TestEnvironment> {
    try {
      // Atomic upsert using existing unique constraint (system_under_test_id, name)
      const result = await this.dataSource.query(
        `INSERT INTO system_under_test_test_environments (name, system_under_test_id)
         VALUES ($1, $2)
         ON CONFLICT (system_under_test_id, name) DO NOTHING
         RETURNING id, name, system_under_test_id, created_at`,
        [name, systemUnderTestId],
      );

      if (result && result.length > 0) {
        this.logger.log(`Created new test environment: ${name} for system ${systemUnderTestId}`);
        return result[0];
      }

      // Row already existed, fetch it
      const existing = await this.dataSource.query(
        `SELECT id, name, system_under_test_id, created_at
         FROM system_under_test_test_environments
         WHERE system_under_test_id = $1 AND name = $2`,
        [systemUnderTestId, name],
      );

      if (!existing || existing.length === 0) {
        throw new DatabaseException('Failed to find or create test environment');
      }

      return existing[0];
    } catch (error) {
      this.logger.error(`Failed to find or create test environment: ${name}`, error);
      throw error;
    }
  }

  /**
   * Find or create a workload for a test environment
   */
  async findOrCreateWorkload(
    testEnvironmentId: string,
    name: string,
    baselineTestRunId?: string,
  ): Promise<Workload> {
    try {
      const defaultConfig = {
        baseline_test_run_id: baselineTestRunId,
        auto_compare_test_runs: false,
        auto_create_snapshots: false,
        difference_score_threshold: 70,
      };

      // Atomic upsert using existing unique constraint (test_environment_id, name)
      const result = await this.dataSource.query(
        `INSERT INTO system_under_test_workloads (name, system_under_test_test_environment_id, config)
         VALUES ($1, $2, $3)
         ON CONFLICT (system_under_test_test_environment_id, name) DO NOTHING
         RETURNING id, name, system_under_test_test_environment_id, config, created_at`,
        [name, testEnvironmentId, JSON.stringify(defaultConfig)],
      );

      if (result && result.length > 0) {
        this.logger.log(`Created new workload: ${name} for environment ${testEnvironmentId}`);
        return result[0];
      }

      // Row already existed, fetch it
      const existing = await this.dataSource.query(
        `SELECT id, name, system_under_test_test_environment_id, config, created_at
         FROM system_under_test_workloads
         WHERE system_under_test_test_environment_id = $1 AND name = $2`,
        [testEnvironmentId, name],
      );

      if (!existing || existing.length === 0) {
        throw new DatabaseException('Failed to find or create workload');
      }

      return existing[0];
    } catch (error) {
      this.logger.error(`Failed to find or create workload: ${name}`, error);
      throw error;
    }
  }

  /**
   * Update the workload config for a given system/environment/workload.
   * Merges the provided fields into the existing config JSONB.
   */
  async updateWorkloadConfig(
    systemUnderTestId: string,
    testEnvironment: string,
    workloadName: string,
    configUpdate: Record<string, unknown>,
  ): Promise<void> {
    // Look up the test environment ID
    const envResult = await this.dataSource.query(
      `SELECT id FROM system_under_test_test_environments
       WHERE system_under_test_id = $1 AND name = $2`,
      [systemUnderTestId, testEnvironment],
    );

    if (!envResult || envResult.length === 0) {
      throw new Error(`Test environment '${testEnvironment}' not found for system ${systemUnderTestId}`);
    }

    const testEnvironmentId = envResult[0].id;

    // Merge config update into existing config
    const updateResult = await this.dataSource.query(
      `UPDATE system_under_test_workloads
       SET config = COALESCE(config, '{}'::jsonb) || $1::jsonb
       WHERE system_under_test_test_environment_id = $2 AND name = $3`,
      [JSON.stringify(configUpdate), testEnvironmentId, workloadName],
    );

    // updateResult[1] is the affected row count in raw PostgreSQL results
    const affectedRows = updateResult?.[1] ?? updateResult?.rowCount ?? 0;
    if (affectedRows === 0) {
      throw new Error(`Workload '${workloadName}' not found for environment '${testEnvironment}'`);
    }

    this.logger.log(`Updated workload config for ${workloadName} in ${testEnvironment}: ${JSON.stringify(configUpdate)}`);
  }

  /**
   * Get the workload config for a given system/environment/workload.
   */
  async getWorkloadConfig(
    systemUnderTestId: string,
    testEnvironment: string,
    workloadName: string,
  ): Promise<Record<string, unknown> | null> {
    const result = await this.dataSource.query(
      `SELECT w.config
       FROM system_under_test_workloads w
       INNER JOIN system_under_test_test_environments e
         ON w.system_under_test_test_environment_id = e.id
       WHERE e.system_under_test_id = $1
         AND e.name = $2
         AND w.name = $3`,
      [systemUnderTestId, testEnvironment, workloadName],
    );

    return result?.[0]?.config || null;
  }

  /**
   * The default team **of one organization**, created if that organization has none.
   *
   * `organizationId` is not optional and must not be made so. This result is stamped
   * on every auto-created system under test (`findOrCreateSystemUnderTest`), and
   * `systems_under_test` RLS reads `can_access_resource(org, team, created_by)` — so a
   * team belonging to a different organization than the system does not merely look
   * untidy, it makes members of the owning organization lose access to a system their
   * own CI just created. Before v0.2.97.39 this was
   * `SELECT id, name FROM teams ORDER BY created_at ASC LIMIT 1` with no predicate at
   * all: organization from the caller, team from whichever organization was created
   * first in the deployment. Single-org deploys never noticed.
   *
   * Returns null rather than throwing when the team cannot be resolved — the caller
   * writes `team_id` as nullable and a system with no team is valid. Returning
   * *someone else's* team is what is not.
   */
  async getDefaultTeam(organizationId: string): Promise<{ id: string; name: string } | null> {
    try {
      // A system under test with no organization cannot be given a team at all: every
      // candidate would belong to an organization this system does not. Fail soft, as
      // the catch below does.
      if (!organizationId) {
        this.logger.warn('getDefaultTeam called with no organizationId; no team will be assigned');
        return null;
      }

      // Raw SQL rather than the repository: this runs on the pooled connection on
      // purpose. `teams` carries an RLS SELECT policy, and this path is reached from
      // `/api/init` and from the first test run for a new system name — both of which
      // are API-key principals whose membership rows frequently do not exist (see the
      // api-key carve-out in apps/api/CLAUDE.md). The organization predicate is what
      // makes that safe: it is the caller's own organization, resolved upstream, not
      // something read out of the request.
      const teamRows = await this.dataSource.query(
        `SELECT id, name FROM teams WHERE organization_id = $1 ORDER BY created_at ASC LIMIT 1`,
        [organizationId],
      );
      let team = teamRows.length > 0 ? teamRows[0] as { id: string; name: string } : null;

      if (!team) {
        // The organization already exists — it was resolved before we got here — so
        // this branch only creates the team. It used to also INSERT a
        // 'Default Organization' row, which was unreachable: both callers of
        // findOrCreateSystemUnderTest receive a resolved organizationId.
        try {
          const newTeam = this.teamRepo.create({
            name: 'Default Team',
            description: 'Auto-created default team',
            organization_id: organizationId,
          });
          const saved = await this.teamRepo.save(newTeam);
          team = { id: saved.id, name: saved.name };
        } catch {
          // Concurrent creation. Re-read within the same organization — `teams` has no
          // unique on (organization_id, name), so this is a re-read rather than an
          // ON CONFLICT, and it must carry the predicate or the recovery path
          // reintroduces exactly the bug this method was fixed for.
          const rows = await this.dataSource.query(
            `SELECT id, name FROM teams WHERE organization_id = $1 ORDER BY created_at ASC LIMIT 1`,
            [organizationId],
          );
          team = rows.length > 0 ? rows[0] as { id: string; name: string } : null;
        }
      }

      return team ? { id: team.id, name: team.name } : null;
    } catch (error) {
      this.logger.warn(`Failed to get default team for organization ${organizationId}:`, error);
      return null;
    }
  }
}
