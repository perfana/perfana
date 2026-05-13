import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ResourceNotFoundException,
  DatabaseException,
} from '../../common/exceptions/business.exception';
import { TracingServiceRepository } from '../../repositories/tracing-service.repository';
import { TracingService, OwnedResource, SystemUnderTest } from '@perfana/shared';
import { AuditService } from '../audit/audit.service';
import { withRequestEm } from '../../common/db/request-em';
import {
  CreateTracingServiceDto,
  UpdateTracingServiceDto,
} from './dto/create-tracing-service.dto';

@Injectable()
export class TracingServicesService {
  private readonly logger = new Logger(TracingServicesService.name);

  constructor(
    private readonly tracingServiceRepository: TracingServiceRepository,
    private readonly auditService: AuditService,
    @InjectRepository(SystemUnderTest)
    private readonly sutRepository: Repository<SystemUnderTest>,
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
   */
  async findAllBySystem(
    systemId: string,
    userId: string,
    _roles: string[],
  ): Promise<TracingService[]> {
    try {
      this.logger.debug(`findAllBySystem: systemId=${systemId}, userId=${userId}`);

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

      return tracingService;
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw error;
      }
      this.logger.error('Failed to find tracing service:', error);
      throw new DatabaseException('Failed to retrieve tracing service', error);
    }
  }

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

      const sut = await withRequestEm(this.sutRepository).findOne({
        where: { id: createDto.systemUnderTestId },
      });
      if (!sut) {
        throw new ResourceNotFoundException('System under test', createDto.systemUnderTestId);
      }

      // Phase 5a: split the upsert into CREATE vs UPDATE for accurate audit
      // semantics. The repository performs the same findByExactMatch internally,
      // so this adds one extra SELECT on this rarely-called write path — an
      // acceptable trade-off for "one row per logical user action" auditing.
      const existing = await this.tracingServiceRepository.findByExactMatch(
        createDto.systemUnderTestId,
        createDto.testEnvironment ?? null,
        createDto.workload ?? null,
      );
      const before = existing
        ? Object.assign(new TracingService(), existing)
        : null;

      const tracingService =
        await this.tracingServiceRepository.createOrUpdate({
          systemUnderTestId: createDto.systemUnderTestId,
          testEnvironment: createDto.testEnvironment ?? null,
          workload: createDto.workload ?? null,
          tracingInstanceId: createDto.tracingInstanceId,
          serviceNames: createDto.serviceNames,
          organizationId: sut.organization_id,
        });

      // TracingService has the same camelCase / snake_case mismatch as the
      // other Phase 5a integrations — pass organizationIdOverride explicitly.
      if (before) {
        this.auditService.logUpdate(
          before as unknown as OwnedResource,
          tracingService as unknown as OwnedResource,
          { organizationIdOverride: before.organizationId ?? tracingService.organizationId },
        );
      } else {
        this.auditService.logCreate(tracingService as unknown as OwnedResource, {
          organizationIdOverride: tracingService.organizationId,
        });
      }

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

      // Capture pre-update snapshot for the audit diff before the in-place
      // repository.update mutates the row.
      const before = Object.assign(new TracingService(), existing);

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

      const after = await this.tracingServiceRepository.findById(id);

      this.auditService.logUpdate(
        before as unknown as OwnedResource,
        after as unknown as OwnedResource,
        { organizationIdOverride: before.organizationId ?? after.organizationId },
      );

      this.logger.log(`Tracing service ${id} updated successfully`);
      return after;
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
   */
  async delete(id: string, userId: string, _roles: string[]): Promise<void> {
    try {
      this.logger.debug(`delete: id=${id}, userId=${userId}`);

      // Check if it exists first
      const tracingService = await this.tracingServiceRepository.findById(id);
      if (!tracingService) {
        throw new ResourceNotFoundException('Tracing service', id);
      }

      // Phase 5a: log DELETE before the row is removed so the diff captures the
      // pre-delete state. organizationIdOverride bridges the camelCase property /
      // snake_case column mismatch.
      this.auditService.logDelete(tracingService as unknown as OwnedResource, {
        organizationIdOverride: tracingService.organizationId,
      });

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
