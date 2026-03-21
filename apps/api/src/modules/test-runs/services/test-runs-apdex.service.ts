import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TestRun, SystemUnderTest as SystemEntity } from '@perfana/shared';
import { SetApdexThresholdDto, WorkloadApdexThresholdDto, WorkloadTransactionApdexThresholdDto } from '../dto/apdex-threshold.dto';
import { ResourceNotFoundException } from '../../../common/exceptions/business.exception';
import { AuthorizationService } from '../../../common/services/authorization.service';

/**
 * Global admin roles that bypass organization filtering
 */
const ADMIN_ROLES = ['perfana-admin', 'super-admin', 'admin'];

/**
 * Service for managing Apdex threshold configuration at workload level
 * Thresholds are persisted by system_under_test + test_environment + workload
 * and apply to all test runs with those properties
 */
@Injectable()
export class TestRunsApdexService {
  private readonly logger = new Logger(TestRunsApdexService.name);

  constructor(
    @InjectRepository(TestRun)
    private testRunRepo: Repository<TestRun>,
    @InjectRepository(SystemEntity)
    private systemRepo: Repository<SystemEntity>,
    private readonly authzService: AuthorizationService,
  ) {}

  /**
   * Check if a user has global admin role
   */
  private isGlobalAdmin(roles: string[]): boolean {
    return roles.some(role => ADMIN_ROLES.includes(role));
  }

  /**
   * Validate that the user has access to the specified system under test
   * @param systemId - The UUID of the system under test
   * @returns void if access is granted
   * @throws ResourceNotFoundException if system not found or access is denied (hides resource existence)
   */
  private async validateSystemAccess(
    systemId: string,
    userId: string,
    roles: string[],
  ): Promise<void> {
    const isAdmin = this.isGlobalAdmin(roles);

    // Build query with organization filtering
    const systemQuery = this.systemRepo.createQueryBuilder('sut')
      .where('sut.id = :id', { id: systemId })
      .select(['sut.id']);

    // Apply organization filter for non-admin users
    if (!isAdmin) {
      const organizationIds = await this.authzService.getAccessibleOrganizations(userId);
      if (organizationIds.length === 0) {
        this.logger.debug('User has no organization memberships, access denied');
        throw new ResourceNotFoundException('System', systemId);
      }
      systemQuery.andWhere('sut.organization_id IN (:...orgIds)', { orgIds: organizationIds });
    }

    const system = await systemQuery.getOne();

    if (!system) {
      throw new ResourceNotFoundException('System', systemId);
    }
  }

  /**
   * Get workload-level Apdex threshold
   */
  async getWorkloadApdexThreshold(
    systemUnderTestId: string,
    testEnvironment: string,
    workload: string,
    userId: string = '',
    roles: string[] = [],
  ): Promise<WorkloadApdexThresholdDto> {
    try {
      this.logger.log(`Getting workload Apdex threshold for SUT ${systemUnderTestId}/${testEnvironment}/${workload}`);

      // Validate user has access to the system (systemUnderTestId is a UUID)
      await this.validateSystemAccess(systemUnderTestId, userId, roles);

      const query = `
        SELECT system_under_test_id, test_environment, workload, apdex_threshold, created_at, updated_at
        FROM workload_apdex_thresholds
        WHERE system_under_test_id = $1
          AND test_environment = $2
          AND workload = $3
      `;

      const result = await this.testRunRepo.query(query, [systemUnderTestId, testEnvironment, workload]);

      if (!result || result.length === 0) {
        // Return default if no threshold configured
        return {
          system_under_test_id: systemUnderTestId,
          test_environment: testEnvironment,
          workload: workload,
          apdex_threshold: 500, // Default
        };
      }

      return {
        system_under_test_id: result[0].system_under_test_id,
        test_environment: result[0].test_environment,
        workload: result[0].workload,
        apdex_threshold: parseInt(result[0].apdex_threshold, 10),
        created_at: result[0].created_at,
        updated_at: result[0].updated_at,
      };
    } catch (error) {
      this.logger.error(`Failed to get workload Apdex threshold:`, error);
      throw error;
    }
  }

  /**
   * Set workload-level Apdex threshold (creates or updates)
   */
  async setWorkloadApdexThreshold(
    systemUnderTestId: string,
    testEnvironment: string,
    workload: string,
    dto: SetApdexThresholdDto,
    userId: string = '',
    roles: string[] = [],
  ): Promise<WorkloadApdexThresholdDto> {
    try {
      this.logger.log(`Setting workload Apdex threshold for ${systemUnderTestId}/${testEnvironment}/${workload} to ${dto.apdex_threshold}ms`);

      // Validate user has access to the system
      await this.validateSystemAccess(systemUnderTestId, userId, roles);

      // Upsert the workload threshold
      const upsertQuery = `
        INSERT INTO workload_apdex_thresholds (system_under_test_id, test_environment, workload, apdex_threshold)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (system_under_test_id, test_environment, workload)
        DO UPDATE SET
          apdex_threshold = EXCLUDED.apdex_threshold,
          updated_at = CURRENT_TIMESTAMP
        RETURNING id, system_under_test_id, test_environment, workload, apdex_threshold, created_at, updated_at
      `;

      const result = await this.testRunRepo.query(upsertQuery, [
        systemUnderTestId,
        testEnvironment,
        workload,
        dto.apdex_threshold,
      ]);

      return {
        id: result[0].id,
        system_under_test_id: result[0].system_under_test_id,
        test_environment: result[0].test_environment,
        workload: result[0].workload,
        apdex_threshold: parseInt(result[0].apdex_threshold, 10),
        created_at: result[0].created_at,
        updated_at: result[0].updated_at,
      };
    } catch (error) {
      this.logger.error(`Failed to set workload Apdex threshold:`, error);
      throw error;
    }
  }

  /**
   * Get all transaction-level Apdex thresholds for a workload
   */
  async getWorkloadTransactionApdexThresholds(
    systemUnderTestId: string,
    testEnvironment: string,
    workload: string,
    userId: string = '',
    roles: string[] = [],
  ): Promise<WorkloadTransactionApdexThresholdDto[]> {
    try {
      this.logger.log(`Getting transaction Apdex thresholds for ${systemUnderTestId}/${testEnvironment}/${workload}`);

      // Validate user has access to the system
      await this.validateSystemAccess(systemUnderTestId, userId, roles);

      const query = `
        SELECT id, system_under_test_id, test_environment, workload, transaction_name, apdex_threshold, created_at, updated_at
        FROM workload_transaction_apdex_thresholds
        WHERE system_under_test_id = $1
          AND test_environment = $2
          AND workload = $3
        ORDER BY transaction_name ASC
      `;

      const result = await this.testRunRepo.query(query, [systemUnderTestId, testEnvironment, workload]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return result.map((row: any) => ({
        id: row.id,
        system_under_test_id: row.system_under_test_id,
        test_environment: row.test_environment,
        workload: row.workload,
        transaction_name: row.transaction_name,
        apdex_threshold: parseInt(row.apdex_threshold, 10),
        created_at: row.created_at,
        updated_at: row.updated_at,
      }));
    } catch (error) {
      this.logger.error(`Failed to get transaction Apdex thresholds:`, error);
      throw error;
    }
  }

  /**
   * Set transaction-level Apdex threshold (creates or updates)
   */
  async setWorkloadTransactionApdexThreshold(
    systemUnderTestId: string,
    testEnvironment: string,
    workload: string,
    transactionName: string,
    dto: SetApdexThresholdDto,
    userId: string = '',
    roles: string[] = [],
  ): Promise<WorkloadTransactionApdexThresholdDto> {
    try {
      this.logger.log(`Setting transaction Apdex threshold for ${transactionName} in ${systemUnderTestId}/${testEnvironment}/${workload} to ${dto.apdex_threshold}ms`);

      // Validate user has access to the system
      await this.validateSystemAccess(systemUnderTestId, userId, roles);

      // Upsert the transaction threshold
      const upsertQuery = `
        INSERT INTO workload_transaction_apdex_thresholds
          (system_under_test_id, test_environment, workload, transaction_name, apdex_threshold)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (system_under_test_id, test_environment, workload, transaction_name)
        DO UPDATE SET
          apdex_threshold = EXCLUDED.apdex_threshold,
          updated_at = CURRENT_TIMESTAMP
        RETURNING id, system_under_test_id, test_environment, workload, transaction_name, apdex_threshold, created_at, updated_at
      `;

      const result = await this.testRunRepo.query(upsertQuery, [
        systemUnderTestId,
        testEnvironment,
        workload,
        transactionName,
        dto.apdex_threshold,
      ]);

      return {
        id: result[0].id,
        system_under_test_id: result[0].system_under_test_id,
        test_environment: result[0].test_environment,
        workload: result[0].workload,
        transaction_name: result[0].transaction_name,
        apdex_threshold: parseInt(result[0].apdex_threshold, 10),
        created_at: result[0].created_at,
        updated_at: result[0].updated_at,
      };
    } catch (error) {
      this.logger.error(`Failed to set transaction Apdex threshold:`, error);
      throw error;
    }
  }

  /**
   * Delete transaction-level Apdex threshold (reverts to workload-level default)
   */
  async deleteWorkloadTransactionApdexThreshold(
    systemUnderTestId: string,
    testEnvironment: string,
    workload: string,
    transactionName: string,
    userId: string = '',
    roles: string[] = [],
  ): Promise<{ message: string }> {
    try {
      this.logger.log(`Deleting transaction Apdex threshold for ${transactionName} in ${systemUnderTestId}/${testEnvironment}/${workload}`);

      // Validate user has access to the system
      await this.validateSystemAccess(systemUnderTestId, userId, roles);

      const deleteQuery = `
        DELETE FROM workload_transaction_apdex_thresholds
        WHERE system_under_test_id = $1
          AND test_environment = $2
          AND workload = $3
          AND transaction_name = $4
        RETURNING id
      `;

      const result = await this.testRunRepo.query(deleteQuery, [
        systemUnderTestId,
        testEnvironment,
        workload,
        transactionName,
      ]);

      if (!result || result.length === 0) {
        throw new NotFoundException(
          `Transaction threshold for ${transactionName} in ${systemUnderTestId}/${testEnvironment}/${workload} not found`,
        );
      }

      return {
        message: `Threshold for transaction ${transactionName} reset to workload default`,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to delete transaction Apdex threshold:`, error);
      throw error;
    }
  }
}
