import { Injectable, Logger, ConflictException } from '@nestjs/common';
import {
  ResourceNotFoundException,
  DatabaseException,
} from '../../common/exceptions/business.exception';
import { TracingServiceRepository } from '../../repositories/tracing-service.repository';
import { TracingService } from '@perfana/shared/entities';
import {
  CreateTracingServiceDto,
  UpdateTracingServiceDto,
} from './dto/create-tracing-service.dto';
// NOTE: AuthorizationService will be re-added when Phase 4 adds organization_id to TracingService

/**
 * Service responsible for managing tracing service configurations.
 *
 * Authorization:
 * - All methods accept userId and roles parameters for future authorization
 * - Currently TracingService entity does not have organization_id, so all data is treated as legacy
 * - When organization_id is added to TracingService (Phase 4), authorization checks will be enabled
 * - Global admins bypass all authorization checks
 */
@Injectable()
export class TracingServicesService {
  private readonly logger = new Logger(TracingServicesService.name);

  constructor(
    private readonly tracingServiceRepository: TracingServiceRepository,
  ) {}

  /**
   * Find tracing service with hierarchical resolution
   *
   * Resolution order:
   * 1. Most specific: system + environment + workload
   * 2. Environment level: system + environment (workload IS NULL)
   * 3. System level: system only (environment IS NULL, workload IS NULL)
   *
   * Returns the first match found
   *
   * @param systemId - The system under test ID
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   * @param environment - Optional environment filter
   * @param workload - Optional workload filter
   *
   * Note: TracingService entity does not have organization_id yet, so access checks are not applied.
   * Full access permission checks will be enabled when Phase 4 adds organization_id column.
   */
  async findTracingService(
    systemId: string,
    userId: string,
    _roles: string[],
    environment?: string,
    workload?: string,
  ): Promise<TracingService | null> {
    try {
      this.logger.debug(`findTracingService: systemId=${systemId}, userId=${userId}`);

      // NOTE: Access permission check will be added here when TracingService entity has organization_id
      // For now, all tracing services are accessible (treated as legacy data)

      return await this.tracingServiceRepository.findWithHierarchy(
        systemId,
        environment,
        workload,
      );
    } catch (error) {
      this.logger.error('Failed to find tracing service:', error);
      throw new DatabaseException('Failed to retrieve tracing service', error);
    }
  }

  /**
   * Get all tracing services for a system (for configuration UI)
   *
   * @param systemId - The system under test ID
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Note: TracingService entity does not have organization_id yet, so org filtering is not applied.
   * Full org filtering will be enabled when Phase 4 adds organization_id column.
   */
  async findAllBySystem(
    systemId: string,
    userId: string,
    _roles: string[],
  ): Promise<TracingService[]> {
    try {
      this.logger.debug(`findAllBySystem: systemId=${systemId}, userId=${userId}`);

      // NOTE: Org filtering will be added here when TracingService entity has organization_id
      // For now, all tracing services are returned (treated as legacy data)

      return await this.tracingServiceRepository.findBySystemId(systemId);
    } catch (error) {
      this.logger.error('Failed to find tracing services by system:', error);
      throw new DatabaseException(
        'Failed to retrieve tracing services',
        error,
      );
    }
  }

  /**
   * Get a single tracing service by ID
   *
   * @param id - The tracing service ID
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Note: TracingService entity does not have organization_id yet, so access checks are not applied.
   * Full access permission checks will be enabled when Phase 4 adds organization_id column.
   */
  async findOne(
    id: string,
    userId: string,
    _roles: string[],
  ): Promise<TracingService> {
    try {
      this.logger.debug(`findOne: id=${id}, userId=${userId}`);

      const tracingService = await this.tracingServiceRepository.findById(id);

      if (!tracingService) {
        throw new ResourceNotFoundException('Tracing service', id);
      }

      // NOTE: Access permission check will be added here when TracingService entity has organization_id
      // For now, all tracing services are accessible (treated as legacy data)

      return tracingService;
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw error;
      }
      this.logger.error('Failed to find tracing service:', error);
      throw new DatabaseException('Failed to retrieve tracing service', error);
    }
  }

  /**
   * Create or update a tracing service
   * Uses createOrUpdate to handle conflicts automatically
   *
   * @param createDto - The create/update DTO
   * @param userId - The user ID for authorization and ownership tracking
   * @param roles - The user's roles for authorization checks
   *
   * Note: TracingService entity does not have organization_id or created_by/updated_by yet,
   * so ownership tracking is not applied. Full ownership assignment will be enabled when
   * Phase 4 adds the ownership columns.
   */
  async createOrUpdate(
    createDto: CreateTracingServiceDto,
    userId: string,
    _roles: string[],
  ): Promise<TracingService> {
    try {
      this.logger.debug(`createOrUpdate: userId=${userId}`);

      this.logger.log(
        `Creating/updating tracing service for system ${createDto.systemUnderTestId}, ` +
          `instance: ${createDto.tracingInstanceId}, ` +
          `environment: ${createDto.testEnvironment ?? 'all'}, ` +
          `workload: ${createDto.workload ?? 'all'}, ` +
          `services: ${createDto.serviceNames.join(', ')}`,
      );

      // NOTE: created_by, updated_by, organization_id will be set when Phase 4 adds those columns

      const tracingService =
        await this.tracingServiceRepository.createOrUpdate({
          systemUnderTestId: createDto.systemUnderTestId,
          testEnvironment: createDto.testEnvironment ?? null,
          workload: createDto.workload ?? null,
          tracingInstanceId: createDto.tracingInstanceId,
          serviceNames: createDto.serviceNames,
        });

      this.logger.log(`Tracing service saved with ID: ${tracingService.id}`);
      return tracingService;
    } catch (error) {
      this.logger.error('Failed to create or update tracing service:', error);

      // Check for unique constraint violation
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === '23505'
      ) {
        throw new ConflictException(
          'A tracing service with this system/environment/workload/instance combination already exists',
        );
      }

      throw new DatabaseException(
        'Failed to create or update tracing service',
        error,
      );
    }
  }

  /**
   * Update an existing tracing service by ID
   *
   * @param id - The tracing service ID
   * @param updateDto - The update DTO
   * @param userId - The user ID for authorization and ownership tracking
   * @param roles - The user's roles for authorization checks
   *
   * Note: TracingService entity does not have organization_id yet, so permission checks are not applied.
   * Full permission checks will be enabled when Phase 4 adds organization_id column.
   */
  async update(
    id: string,
    updateDto: UpdateTracingServiceDto,
    userId: string,
    _roles: string[],
  ): Promise<TracingService> {
    try {
      this.logger.debug(`update: id=${id}, userId=${userId}`);

      // Check if it exists first
      const existing = await this.tracingServiceRepository.findById(id);
      if (!existing) {
        throw new ResourceNotFoundException('Tracing service', id);
      }

      // NOTE: Permission check will be added here when TracingService entity has organization_id
      // For now, all tracing services are modifiable (treated as legacy data)

      // NOTE: updated_by will be set when Phase 4 adds that column

      // Update the tracing service
      await this.tracingServiceRepository.update(id, {
        ...(updateDto.testEnvironment !== undefined && {
          testEnvironment: updateDto.testEnvironment,
        }),
        ...(updateDto.workload !== undefined && {
          workload: updateDto.workload,
        }),
        ...(updateDto.tracingInstanceId && {
          tracingInstanceId: updateDto.tracingInstanceId,
        }),
        ...(updateDto.serviceNames && {
          serviceNames: updateDto.serviceNames,
        }),
      } as Partial<TracingService>);

      this.logger.log(`Tracing service ${id} updated successfully`);
      return await this.tracingServiceRepository.findById(id);
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw error;
      }

      // Check for unique constraint violation
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === '23505'
      ) {
        throw new ConflictException(
          'A tracing service with this system/environment/workload/instance combination already exists',
        );
      }

      this.logger.error('Failed to update tracing service:', error);
      throw new DatabaseException('Failed to update tracing service', error);
    }
  }

  /**
   * Delete a tracing service by ID
   *
   * @param id - The tracing service ID
   * @param userId - The user ID for authorization
   * @param roles - The user's roles for authorization checks
   *
   * Note: TracingService entity does not have organization_id yet, so permission checks are not applied.
   * Full permission checks will be enabled when Phase 4 adds organization_id column.
   */
  async delete(id: string, userId: string, _roles: string[]): Promise<void> {
    try {
      this.logger.debug(`delete: id=${id}, userId=${userId}`);

      // Check if it exists first
      const tracingService = await this.tracingServiceRepository.findById(id);
      if (!tracingService) {
        throw new ResourceNotFoundException('Tracing service', id);
      }

      // NOTE: Delete permission check will be added here when TracingService entity has organization_id
      // For now, all tracing services are deletable (treated as legacy data)

      await this.tracingServiceRepository.delete(id);
      this.logger.log(`Tracing service ${id} deleted successfully`);
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw error;
      }
      this.logger.error('Failed to delete tracing service:', error);
      throw new DatabaseException('Failed to delete tracing service', error);
    }
  }
}
