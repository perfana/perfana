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
      // Find system by BOTH name AND organization (organization-scoped)
      // This ensures different orgs can have systems with the same name
      let systemUnderTest = await this.systemRepo.findOne({
        where: {
          name,
          organization_id: organizationId, // ✅ Systems are scoped to organizations
        },
        select: ['id', 'name', 'description', 'team_id', 'organization_id', 'created_at', 'updated_at'],
      });

      if (!systemUnderTest) {
        const team = await this.getDefaultTeam();
        const newSystem = this.systemRepo.create({
          name,
          description: name,
          team_id: team?.id,
          organization_id: organizationId,
          created_by: userId,
          updated_by: userId,
        });
        systemUnderTest = await this.systemRepo.save(newSystem);
        this.logger.log(
          `Created new system under test: ${name} in organization ${organizationId} by user ${userId}`,
        );
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
      const result = await this.dataSource.query(
        `SELECT id, name, system_under_test_id, created_at
         FROM system_under_test_test_environments
         WHERE system_under_test_id = $1 AND name = $2`,
        [systemUnderTestId, name],
      );

      if (result && result.length > 0) {
        return result[0];
      }

      const insertResult = await this.dataSource.query(
        `INSERT INTO system_under_test_test_environments (name, system_under_test_id)
         VALUES ($1, $2)
         RETURNING id, name, system_under_test_id, created_at`,
        [name, systemUnderTestId],
      );

      if (!insertResult || insertResult.length === 0) {
        throw new DatabaseException('Failed to create test environment');
      }

      this.logger.log(`Created new test environment: ${name} for system ${systemUnderTestId}`);
      return insertResult[0];
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
      const result = await this.dataSource.query(
        `SELECT id, name, system_under_test_test_environment_id, config, created_at
         FROM system_under_test_workloads
         WHERE system_under_test_test_environment_id = $1 AND name = $2`,
        [testEnvironmentId, name],
      );

      if (result && result.length > 0) {
        return result[0];
      }

      const defaultConfig = {
        baseline_test_run_id: baselineTestRunId,
        auto_compare_test_runs: false,
        auto_create_snapshots: false,
        difference_score_threshold: 70,
      };

      const insertResult = await this.dataSource.query(
        `INSERT INTO system_under_test_workloads (name, system_under_test_test_environment_id, config)
         VALUES ($1, $2, $3)
         RETURNING id, name, system_under_test_test_environment_id, config, created_at`,
        [name, testEnvironmentId, JSON.stringify(defaultConfig)],
      );

      if (!insertResult || insertResult.length === 0) {
        throw new DatabaseException('Failed to create workload');
      }

      this.logger.log(`Created new workload: ${name} for environment ${testEnvironmentId}`);
      return insertResult[0];
    } catch (error) {
      this.logger.error(`Failed to find or create workload: ${name}`, error);
      throw error;
    }
  }

  /**
   * Get or create the default team and organization
   */
  async getDefaultTeam(): Promise<{ id: string; name: string } | null> {
    try {
      let team = await this.teamRepo.findOne({
        select: ['id', 'name'],
        order: { created_at: 'ASC' },
      });

      if (!team) {
        let org = await this.organizationRepo.findOne({
          select: ['id'],
          order: { created_at: 'ASC' },
        });

        if (!org) {
          const newOrg = this.organizationRepo.create({
            name: 'Default Organization',
            description: 'Auto-created default organization',
          });
          org = await this.organizationRepo.save(newOrg);
        }

        if (org) {
          const newTeam = this.teamRepo.create({
            name: 'Default Team',
            description: 'Auto-created default team',
            organization_id: org.id,
          });
          team = await this.teamRepo.save(newTeam);
        }
      }

      return team ? { id: team.id, name: team.name } : null;
    } catch (error) {
      this.logger.warn('Failed to get default team:', error);
      return null;
    }
  }
}
