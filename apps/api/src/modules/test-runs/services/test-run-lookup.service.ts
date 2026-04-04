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
import {
  SystemUnderTest as SystemEntity,
  Organization,
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
    @InjectRepository(Organization)
    private readonly organizationRepo: Repository<Organization>,
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
      const team = await this.getDefaultTeam();

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
      const systemUnderTest = await this.systemRepo.findOne({
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
   * Get or create the default team and organization
   */
  async getDefaultTeam(): Promise<{ id: string; name: string } | null> {
    try {
      // Use raw SQL to find the oldest team — TypeORM findOne requires a where clause
      const teamRows = await this.dataSource.query(
        `SELECT id, name FROM teams ORDER BY created_at ASC LIMIT 1`
      );
      let team = teamRows.length > 0 ? teamRows[0] as { id: string; name: string } : null;

      if (!team) {
        // Use INSERT ON CONFLICT for org creation to handle concurrent calls.
        // organizations has UNIQUE(name), so this is safe.
        await this.dataSource.query(
          `INSERT INTO organizations (name, description, created_at, updated_at)
           VALUES ($1, $2, NOW(), NOW())
           ON CONFLICT (name) DO NOTHING`,
          ['Default Organization', 'Auto-created default organization'],
        );

        const org = await this.organizationRepo.findOne({
          where: { name: 'Default Organization' },
          select: ['id'],
        });

        if (org) {
          // Create team, handling possible concurrent creation
          try {
            const newTeam = this.teamRepo.create({
              name: 'Default Team',
              description: 'Auto-created default team',
              organization_id: org.id,
            });
            const saved = await this.teamRepo.save(newTeam);
            team = { id: saved.id, name: saved.name };
          } catch {
            // Concurrent creation, fetch the existing team
            const rows = await this.dataSource.query(
              `SELECT id, name FROM teams ORDER BY created_at ASC LIMIT 1`
            );
            team = rows.length > 0 ? rows[0] as { id: string; name: string } : null;
          }
        }
      }

      return team ? { id: team.id, name: team.name } : null;
    } catch (error) {
      this.logger.warn('Failed to get default team:', error);
      return null;
    }
  }
}
