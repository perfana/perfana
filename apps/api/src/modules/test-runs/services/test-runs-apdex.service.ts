import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  SystemUnderTest as SystemEntity,
  WorkloadApdexThreshold,
  WorkloadTransactionApdexThreshold,
} from '@perfana/shared';
import { SetApdexThresholdDto, WorkloadApdexThresholdDto, WorkloadTransactionApdexThresholdDto } from '../dto/apdex-threshold.dto';
import { ResourceNotFoundException } from '../../../common/exceptions/business.exception';
import { AuthorizationService } from '../../../common/services/authorization.service';
import { AuditService } from '../../audit/audit.service';
import type { OwnedResource } from '@perfana/shared';

/**
 * Service for managing Apdex threshold configuration at workload level
 * Thresholds are persisted by system_under_test + test_environment + workload
 * and apply to all test runs with those properties
 */
@Injectable()
export class TestRunsApdexService {
  private readonly logger = new Logger(TestRunsApdexService.name);

  constructor(
    @InjectRepository(SystemEntity)
    private systemRepo: Repository<SystemEntity>,
    @InjectRepository(WorkloadApdexThreshold)
    private workloadApdexRepo: Repository<WorkloadApdexThreshold>,
    @InjectRepository(WorkloadTransactionApdexThreshold)
    private transactionApdexRepo: Repository<WorkloadTransactionApdexThreshold>,
    private readonly authzService: AuthorizationService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Validate that the user has access to the specified system under test
   * @throws ResourceNotFoundException if system not found or access is denied (hides resource existence)
   */
  private async validateSystemAccess(
    systemId: string,
    userId: string,
    roles: string[],
  ): Promise<SystemEntity> {
    const system = await this.systemRepo.findOne({ where: { id: systemId } });
    if (!system) {
      throw new ResourceNotFoundException('System', systemId);
    }

    const result = await this.authzService.canAccessResource(userId, roles, {
      organization_id: system.organization_id,
      created_by: system.created_by ?? '',
    } as OwnedResource);

    if (!result.allowed) {
      throw new ResourceNotFoundException('System', systemId);
    }

    return system;
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

      const existing = await this.workloadApdexRepo.findOne({
        where: { system_under_test_id: systemUnderTestId, test_environment: testEnvironment, workload },
      });

      if (!existing) {
        // Return default if no threshold configured
        return {
          system_under_test_id: systemUnderTestId,
          test_environment: testEnvironment,
          workload,
          apdex_threshold: 500, // Default
        };
      }

      return {
        id: existing.id,
        system_under_test_id: existing.system_under_test_id,
        test_environment: existing.test_environment,
        workload: existing.workload,
        apdex_threshold: existing.apdex_threshold,
        created_at: existing.created_at?.toISOString(),
        updated_at: existing.updated_at?.toISOString(),
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

      const system = await this.validateSystemAccess(systemUnderTestId, userId, roles);

      const existing = await this.workloadApdexRepo.findOne({
        where: { system_under_test_id: systemUnderTestId, test_environment: testEnvironment, workload },
      });

      let saved: WorkloadApdexThreshold;
      if (!existing) {
        const entity = this.workloadApdexRepo.create({
          system_under_test_id: systemUnderTestId,
          test_environment: testEnvironment,
          workload,
          apdex_threshold: dto.apdex_threshold,
          organization_id: system.organization_id,
          team_id: system.team_id,
          created_by: userId,
          updated_by: userId,
        });
        saved = await this.workloadApdexRepo.save(entity);
        this.auditService.logCreate(saved, { organizationIdOverride: saved.organization_id });
      } else {
        const before = Object.assign(new WorkloadApdexThreshold(), existing);
        existing.apdex_threshold = dto.apdex_threshold;
        existing.updated_by = userId;
        // Backfill ownership if missing (legacy rows pre-audit fix)
        if (!existing.organization_id) existing.organization_id = system.organization_id;
        if (!existing.team_id && system.team_id) existing.team_id = system.team_id;
        if (!existing.created_by) existing.created_by = userId;
        saved = await this.workloadApdexRepo.save(existing);
        this.auditService.logUpdate(before, saved, {
          organizationIdOverride: saved.organization_id ?? before.organization_id,
        });
      }

      return {
        id: saved.id,
        system_under_test_id: saved.system_under_test_id,
        test_environment: saved.test_environment,
        workload: saved.workload,
        apdex_threshold: saved.apdex_threshold,
        created_at: saved.created_at?.toISOString(),
        updated_at: saved.updated_at?.toISOString(),
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

      await this.validateSystemAccess(systemUnderTestId, userId, roles);

      const rows = await this.transactionApdexRepo.find({
        where: { system_under_test_id: systemUnderTestId, test_environment: testEnvironment, workload },
        order: { transaction_name: 'ASC' },
      });

      return rows.map((row) => ({
        id: row.id,
        system_under_test_id: row.system_under_test_id,
        test_environment: row.test_environment,
        workload: row.workload,
        transaction_name: row.transaction_name,
        apdex_threshold: row.apdex_threshold,
        created_at: row.created_at?.toISOString(),
        updated_at: row.updated_at?.toISOString(),
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

      const system = await this.validateSystemAccess(systemUnderTestId, userId, roles);

      const existing = await this.transactionApdexRepo.findOne({
        where: {
          system_under_test_id: systemUnderTestId,
          test_environment: testEnvironment,
          workload,
          transaction_name: transactionName,
        },
      });

      let saved: WorkloadTransactionApdexThreshold;
      if (!existing) {
        const entity = this.transactionApdexRepo.create({
          system_under_test_id: systemUnderTestId,
          test_environment: testEnvironment,
          workload,
          transaction_name: transactionName,
          apdex_threshold: dto.apdex_threshold,
          organization_id: system.organization_id,
          team_id: system.team_id,
          created_by: userId,
          updated_by: userId,
        });
        saved = await this.transactionApdexRepo.save(entity);
        this.auditService.logCreate(saved, { organizationIdOverride: saved.organization_id });
      } else {
        const before = Object.assign(new WorkloadTransactionApdexThreshold(), existing);
        existing.apdex_threshold = dto.apdex_threshold;
        existing.updated_by = userId;
        if (!existing.organization_id) existing.organization_id = system.organization_id;
        if (!existing.team_id && system.team_id) existing.team_id = system.team_id;
        if (!existing.created_by) existing.created_by = userId;
        saved = await this.transactionApdexRepo.save(existing);
        this.auditService.logUpdate(before, saved, {
          organizationIdOverride: saved.organization_id ?? before.organization_id,
        });
      }

      return {
        id: saved.id,
        system_under_test_id: saved.system_under_test_id,
        test_environment: saved.test_environment,
        workload: saved.workload,
        transaction_name: saved.transaction_name,
        apdex_threshold: saved.apdex_threshold,
        created_at: saved.created_at?.toISOString(),
        updated_at: saved.updated_at?.toISOString(),
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

      await this.validateSystemAccess(systemUnderTestId, userId, roles);

      const existing = await this.transactionApdexRepo.findOne({
        where: {
          system_under_test_id: systemUnderTestId,
          test_environment: testEnvironment,
          workload,
          transaction_name: transactionName,
        },
      });

      if (!existing) {
        throw new NotFoundException(
          `Transaction threshold for ${transactionName} in ${systemUnderTestId}/${testEnvironment}/${workload} not found`,
        );
      }

      const snapshot = Object.assign(new WorkloadTransactionApdexThreshold(), existing);
      await this.transactionApdexRepo.remove(existing);
      this.auditService.logDelete(snapshot, { organizationIdOverride: snapshot.organization_id });

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
