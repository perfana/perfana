import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import {
  TestRun as TestRunEntity,
  DsChangePoints,
  SystemUnderTest,
} from '../../../entities';
import { DatabaseException, ResourceNotFoundException } from '../../../common/exceptions/business.exception';
import { BullMQClientService } from '../../data-science/services/bullmq-client.service';

/**
 * Global admin roles that bypass organization filtering
 */
const ADMIN_ROLES = ['perfana-admin', 'super-admin', 'admin'];

@Injectable()
export class TestRunsChangepointService {
  private readonly logger = new Logger(TestRunsChangepointService.name);

  constructor(
    @InjectRepository(TestRunEntity)
    private testRunRepo: Repository<TestRunEntity>,
    @InjectRepository(DsChangePoints)
    private changePointsRepo: Repository<DsChangePoints>,
    @InjectRepository(SystemUnderTest)
    private systemRepo: Repository<SystemUnderTest>,
    private bullmqClientService: BullMQClientService,
    private dataSource: DataSource,
  ) {}

  /**
   * Check if a user has global admin role
   */
  private isGlobalAdmin(roles: string[]): boolean {
    return roles.some(role => ADMIN_ROLES.includes(role));
  }

  /**
   * Validate that a user has access to a system under test via organization membership
   * Returns true if access is granted, false otherwise
   */
  private async validateSystemAccess(
    systemUnderTestId: string,
    roles: string[],
    organizationIds: string[],
  ): Promise<boolean> {
    // Admins have access to all systems
    if (this.isGlobalAdmin(roles)) {
      return true;
    }

    // Non-admin users with no organization memberships have no access
    if (organizationIds.length === 0) {
      return false;
    }

    // Check if the system belongs to an organization the user has access to
    const system = await this.systemRepo
      .createQueryBuilder('sut')
      .leftJoin('sut.team', 'team')
      .where('sut.id = :systemId', { systemId: systemUnderTestId })
      .andWhere('sut.organization_id IN (:...orgIds)', { orgIds: organizationIds })
      .getOne();

    return !!system;
  }

  /**
   * Get test runs created after a specific changepoint
   * Internal helper method - organization filtering is applied at the caller level
   */
  async getTestRunsAfterChangepoint(
    systemUnderTestId: string,
    testEnvironment: string,
    workload: string,
    changepointTestRunId: string
  ): Promise<string[]> {
    try {
      // Get the changepoint test run to get its creation date
      const changepointTestRun = await this.testRunRepo.findOne({
        where: {
          systemUnderTestId,
          testEnvironment,
          workload,
          testRunId: changepointTestRunId
        },
        select: ['createdAt', 'testRunId']
      });

      if (!changepointTestRun) {
        this.logger.warn(`Changepoint test run not found: ${changepointTestRunId}`);
        return [];
      }

      // Get all test runs created after the changepoint
      const laterTestRuns = await this.testRunRepo.find({
        where: {
          systemUnderTestId,
          testEnvironment,
          workload
        },
        select: ['testRunId', 'createdAt'],
        order: { createdAt: 'ASC' }
      });

      const testRunIds = laterTestRuns
        .filter(tr => tr.createdAt > changepointTestRun.createdAt)
        .map(tr => tr.testRunId);

      this.logger.log(`Found ${testRunIds.length} test runs after changepoint ${changepointTestRunId}`);
      return testRunIds;
    } catch (error) {
      this.logger.error(`Failed to get test runs after changepoint: ${(error as Error).message}`);
      return [];
    }
  }

  async isTestRunChangepoint(
    systemUnderTestId: string,
    testEnvironment: string,
    workload: string,
    testRunId: string
  ): Promise<boolean> {
    try {
      const changepoint = await this.changePointsRepo.findOne({
        where: {
          system_under_test_id: systemUnderTestId,
          test_environment: testEnvironment,
          workload,
          test_run_id: testRunId
        },
        select: ['id']
      });

      return !!changepoint;
    } catch (error) {
      this.logger.error(`Failed to check if test run is changepoint: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Get test runs more recent than a base test run
   *
   * @param systemUnderTestId - System under test UUID
   * @param testEnvironment - Test environment name
   * @param workload - Workload name
   * @param baseTestRunId - Base test run ID to compare against
   * @param roles - User roles from JWT token (for admin bypass)
   * @param organizationIds - User's accessible organization IDs from JWT token
   */
  async getTestRunsMoreRecentThan(
    systemUnderTestId: string,
    testEnvironment: string,
    workload: string,
    baseTestRunId: string,
    roles: string[] = [],
    organizationIds: string[] = [],
  ): Promise<{ testRunIds: string[] }> {
    try {
      // Validate access if organization filtering is enabled
      if (roles.length > 0 || organizationIds.length > 0) {
        const hasAccess = await this.validateSystemAccess(systemUnderTestId, roles, organizationIds);
        if (!hasAccess) {
          this.logger.debug(`User denied access to system ${systemUnderTestId}`);
          return { testRunIds: [] };
        }
      }

      // Get the base test run to get its creation date
      const baseTestRun = await this.testRunRepo.findOne({
        where: {
          systemUnderTestId,
          testEnvironment,
          workload,
          testRunId: baseTestRunId
        },
        select: ['createdAt', 'testRunId']
      });

      if (!baseTestRun) {
        this.logger.warn(`Base test run not found: ${baseTestRunId}`);
        return { testRunIds: [] };
      }

      // Get all test runs created after the base test run
      const laterTestRuns = await this.testRunRepo.find({
        where: {
          systemUnderTestId,
          testEnvironment,
          workload
        },
        select: ['testRunId', 'createdAt'],
        order: { createdAt: 'ASC' }
      });

      const testRunIds = laterTestRuns
        .filter(tr => tr.createdAt > baseTestRun.createdAt)
        .map(tr => tr.testRunId);

      this.logger.log(`Found ${testRunIds.length} test runs more recent than ${baseTestRunId}`);
      return { testRunIds };
    } catch (error) {
      this.logger.error(`Failed to get test runs more recent than ${baseTestRunId}: ${(error as Error).message}`);
      throw new DatabaseException(`Failed to get test runs more recent than test run: ${(error as Error).message}`);
    }
  }

  /**
   * Mark a test run as a changepoint
   *
   * @param systemUnderTestId - System under test UUID
   * @param testEnvironment - Test environment name
   * @param workload - Workload name
   * @param testRunId - Test run ID to mark as changepoint
   * @param roles - User roles from JWT token (for admin bypass)
   * @param organizationIds - User's accessible organization IDs from JWT token
   */
  async markAsChangepoint(
    systemUnderTestId: string,
    testEnvironment: string,
    workload: string,
    testRunId: string,
    roles: string[] = [],
    organizationIds: string[] = [],
  ): Promise<{ message: string; jobId?: string; jobDetails?: any }> {
    try {
      // Validate access if organization filtering is enabled
      if (roles.length > 0 || organizationIds.length > 0) {
        const hasAccess = await this.validateSystemAccess(systemUnderTestId, roles, organizationIds);
        if (!hasAccess) {
          this.logger.warn(`User denied access to mark changepoint for system ${systemUnderTestId}`);
          throw new ResourceNotFoundException('System', systemUnderTestId);
        }
      }

      // Check if changepoint already exists
      const existingChangepoint = await this.changePointsRepo.findOne({
        where: {
          system_under_test_id: systemUnderTestId,
          test_environment: testEnvironment,
          workload,
          test_run_id: testRunId
        },
        select: ['id']
      });

      if (existingChangepoint) {
        return { message: 'Test run is already marked as a changepoint' };
      }

      // Insert new changepoint
      const newChangepoint = this.changePointsRepo.create({
        system_under_test_id: systemUnderTestId,
        test_environment: testEnvironment,
        workload,
        test_run_id: testRunId
      });

      await this.changePointsRepo.save(newChangepoint);

      this.logger.log(`Marked test run ${testRunId} as changepoint for ${systemUnderTestId}/${testEnvironment}/${workload}`);

      // Delete existing ds_adapt_results for the changepoint test run
      // A changepoint test run is a baseline and should not have comparison results
      const deleteResult = await this.dataSource.query(
        `DELETE FROM ds_adapt_results WHERE test_run_id = $1`,
        [testRunId]
      );
      this.logger.log(`Deleted ${deleteResult[1] || 0} existing adapt results for changepoint test run ${testRunId}`);

      // Also delete adapt conclusion and tracked results for the changepoint
      await this.dataSource.query(
        `DELETE FROM ds_adapt_conclusion WHERE test_run_id = $1`,
        [testRunId]
      );
      await this.dataSource.query(
        `DELETE FROM ds_adapt_tracked_results WHERE test_run_id = $1`,
        [testRunId]
      );

      // Delete tracked results from OTHER test runs that reference the changepoint as the origin
      // When a test run becomes a changepoint, any regressions that were first detected in it
      // should be cleared from subsequent test runs since it's now a fresh baseline
      const deleteTrackedFromOthers = await this.dataSource.query(
        `DELETE FROM ds_adapt_tracked_results WHERE tracked_test_run_id = $1`,
        [testRunId]
      );
      this.logger.log(`Deleted ${deleteTrackedFromOthers[1] || 0} tracked results referencing changepoint ${testRunId}`);

      // Reset adapt_config.differencesAccepted to 'TBD' for the changepoint test run
      await this.dataSource.query(
        `UPDATE test_runs
         SET adapt_config = jsonb_set(COALESCE(adapt_config, '{}'), '{differencesAccepted}', '"TBD"'),
             updated_at = NOW()
         WHERE test_run_id = $1`,
        [testRunId]
      );
      this.logger.log(`Reset differencesAccepted to TBD for changepoint test run ${testRunId}`);

      // Get all test runs that come after this changepoint
      const laterTestRunIds = await this.getTestRunsAfterChangepoint(
        systemUnderTestId,
        testEnvironment,
        workload,
        testRunId
      );

      // Re-evaluate the changepoint and all subsequent test runs
      // The changepoint will get "no baseline" result, subsequent runs will use new control groups
      const testRunIdsToReevaluate = [testRunId, ...laterTestRunIds];

      if (testRunIdsToReevaluate.length > 0) {
        this.logger.log(`Triggering batch re-evaluation for ${testRunIdsToReevaluate.length} test runs (changepoint + subsequent runs)`);

        try {
          // Trigger batch re-evaluation
          const jobResult = await this.bullmqClientService.reevaluateBatch(testRunIdsToReevaluate, {
            checks: true,
            adapt: true
          });

          this.logger.log(`Successfully triggered re-evaluation for test runs: ${testRunIdsToReevaluate.join(', ')}`);

          return {
            message: 'Test run successfully marked as changepoint and re-evaluation triggered',
            jobId: jobResult?.jobId,
            jobDetails: jobResult
          };
        } catch (reevalError) {
          this.logger.error(`Failed to trigger re-evaluation after changepoint marking: ${(reevalError as Error).message}`);
          return { message: 'Test run marked as changepoint, but re-evaluation failed to trigger' };
        }
      }

      return { message: 'Test run successfully marked as changepoint (no subsequent runs to re-evaluate)' };
    } catch (error) {
      this.logger.error('Failed to mark test run as changepoint:', error);
      throw new DatabaseException(`Failed to mark test run as changepoint: ${(error as Error).message}`);
    }
  }

  /**
   * Remove a test run's changepoint status
   *
   * @param systemUnderTestId - System under test UUID
   * @param testEnvironment - Test environment name
   * @param workload - Workload name
   * @param testRunId - Test run ID to remove as changepoint
   * @param roles - User roles from JWT token (for admin bypass)
   * @param organizationIds - User's accessible organization IDs from JWT token
   */
  async removeChangepoint(
    systemUnderTestId: string,
    testEnvironment: string,
    workload: string,
    testRunId: string,
    roles: string[] = [],
    organizationIds: string[] = [],
  ): Promise<{ message: string; jobId?: string; jobDetails?: any }> {
    try {
      // Validate access if organization filtering is enabled
      if (roles.length > 0 || organizationIds.length > 0) {
        const hasAccess = await this.validateSystemAccess(systemUnderTestId, roles, organizationIds);
        if (!hasAccess) {
          this.logger.warn(`User denied access to remove changepoint for system ${systemUnderTestId}`);
          throw new ResourceNotFoundException('System', systemUnderTestId);
        }
      }

      // Check if changepoint exists
      const existingChangepoint = await this.changePointsRepo.findOne({
        where: {
          system_under_test_id: systemUnderTestId,
          test_environment: testEnvironment,
          workload,
          test_run_id: testRunId
        },
        select: ['id']
      });

      if (!existingChangepoint) {
        return { message: 'Test run is not marked as a changepoint' };
      }

      // Check if this is the most recent changepoint
      const mostRecentChangepoint = await this.changePointsRepo.findOne({
        where: {
          system_under_test_id: systemUnderTestId,
          test_environment: testEnvironment,
          workload
        },
        select: ['test_run_id'],
        order: { created_at: 'DESC' }
      });

      const isLatestChangepoint = mostRecentChangepoint?.test_run_id === testRunId;

      // Remove the changepoint
      await this.changePointsRepo.delete({
        system_under_test_id: systemUnderTestId,
        test_environment: testEnvironment,
        workload,
        test_run_id: testRunId
      });

      this.logger.log(`Removed changepoint for test run ${testRunId} for ${systemUnderTestId}/${testEnvironment}/${workload}`);

      // If this was the most recent changepoint, trigger re-evaluation
      if (isLatestChangepoint) {
        this.logger.log(`Removed changepoint was the most recent, triggering re-evaluation from previous changepoint`);

        // Find the previous changepoint
        const previousChangepoint = await this.changePointsRepo.findOne({
          where: {
            system_under_test_id: systemUnderTestId,
            test_environment: testEnvironment,
            workload
          },
          select: ['test_run_id'],
          order: { created_at: 'DESC' }
        });

        // Get test runs to re-evaluate
        let testRunsToReevaluate: string[] = [];

        if (previousChangepoint) {
          // Get test runs from previous changepoint to most recent
          testRunsToReevaluate = await this.getTestRunsAfterChangepoint(
            systemUnderTestId,
            testEnvironment,
            workload,
            previousChangepoint.test_run_id
          );
          // Include the previous changepoint itself
          testRunsToReevaluate = [previousChangepoint.test_run_id, ...testRunsToReevaluate];
        } else {
          // No previous changepoint, get all test runs
          const allTestRuns = await this.testRunRepo.find({
            where: {
              systemUnderTestId,
              testEnvironment,
              workload
            },
            select: ['testRunId'],
            order: { startTime: 'ASC' }
          });
          testRunsToReevaluate = allTestRuns.map(tr => tr.testRunId);
        }

        if (testRunsToReevaluate.length > 0) {
          this.logger.log(`Triggering batch re-evaluation for ${testRunsToReevaluate.length} test runs after changepoint removal`);

          try {
            const jobResult = await this.bullmqClientService.reevaluateBatch(testRunsToReevaluate, {
              checks: true,
              adapt: true
            });

            this.logger.log(`Successfully triggered re-evaluation for test runs: ${testRunsToReevaluate.join(', ')}`);

            return {
              message: 'Changepoint removed and re-evaluation triggered for affected test runs',
              jobId: jobResult?.jobId,
              jobDetails: jobResult
            };
          } catch (reevalError) {
            this.logger.error(`Failed to trigger re-evaluation after changepoint removal: ${(reevalError as Error).message}`);
            return { message: 'Changepoint removed, but re-evaluation failed to trigger' };
          }
        }

        return { message: 'Changepoint removed and re-evaluation triggered for affected test runs' };
      }

      return { message: 'Changepoint removed successfully' };
    } catch (error) {
      this.logger.error('Failed to remove changepoint:', error);
      throw new DatabaseException(`Failed to remove changepoint: ${(error as Error).message}`);
    }
  }

  /**
   * Get test runs after the most recent changepoint for a system/environment/workload
   *
   * @param systemUnderTestId - System under test UUID
   * @param testEnvironment - Test environment name
   * @param workload - Workload name
   * @param roles - User roles from JWT token (for admin bypass)
   * @param organizationIds - User's accessible organization IDs from JWT token
   */
  async getTestRunsAfterMostRecentChangepoint(
    systemUnderTestId: string,
    testEnvironment: string,
    workload: string,
    roles: string[] = [],
    organizationIds: string[] = [],
  ): Promise<{ changepointTestRunId?: string; testRunIds: string[] }> {
    try {
      // Validate access if organization filtering is enabled
      if (roles.length > 0 || organizationIds.length > 0) {
        const hasAccess = await this.validateSystemAccess(systemUnderTestId, roles, organizationIds);
        if (!hasAccess) {
          this.logger.debug(`User denied access to system ${systemUnderTestId}`);
          return { testRunIds: [] };
        }
      }

      // Find the most recent changepoint
      const mostRecentChangepoint = await this.changePointsRepo.findOne({
        where: {
          system_under_test_id: systemUnderTestId,
          test_environment: testEnvironment,
          workload
        },
        select: ['test_run_id', 'created_at'],
        order: { created_at: 'DESC' }
      });

      if (!mostRecentChangepoint) {
        this.logger.log(`No changepoint found for ${systemUnderTestId}/${testEnvironment}/${workload}, returning all test runs`);

        // Return all test runs for this system/environment/workload when no changepoint exists
        const allTestRuns = await this.testRunRepo.find({
          where: {
            systemUnderTestId,
            testEnvironment,
            workload
          },
          select: ['testRunId'],
          order: { createdAt: 'ASC' }
        });

        return { testRunIds: allTestRuns.map(tr => tr.testRunId) };
      }

      // Get test runs after the changepoint
      const testRunIds = await this.getTestRunsAfterChangepoint(
        systemUnderTestId,
        testEnvironment,
        workload,
        mostRecentChangepoint.test_run_id
      );

      return {
        changepointTestRunId: mostRecentChangepoint.test_run_id,
        testRunIds
      };
    } catch (error) {
      this.logger.error(`Failed to get test runs after most recent changepoint: ${(error as Error).message}`);
      throw new DatabaseException(`Failed to get test runs after most recent changepoint: ${(error as Error).message}`);
    }
  }
}
