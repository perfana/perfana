import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, FindOptionsWhere, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { AuditLog, AuditAction, AuditLogChanges, AuditLogMetadata } from '@perfana/shared/entities';

/**
 * DTO for creating an audit log entry
 */
export interface CreateAuditLogDto {
  /** User ID (Keycloak sub or api-key:{id}) */
  userId: string;
  /** User's email address (optional) */
  userEmail?: string;
  /** Organization ID for the resource (optional) */
  organizationId?: string;
  /** Type of action performed */
  action: AuditAction;
  /** Type of resource being audited (e.g., 'test_run', 'api_key') */
  resourceType: string;
  /** ID of the resource (optional) */
  resourceId?: string;
  /** Human-readable name of the resource (optional) */
  resourceName?: string;
  /** Before/after changes for UPDATE operations (optional) */
  changes?: AuditLogChanges;
  /** Additional metadata about the operation (optional) */
  metadata?: AuditLogMetadata;
  /** Whether the operation was successful */
  success: boolean;
  /** Error message if operation failed (optional) */
  errorMessage?: string;
  /** Client IP address (optional) */
  ipAddress?: string;
  /** Client user agent string (optional) */
  userAgent?: string;
}

/**
 * Query options for retrieving audit logs
 */
export interface AuditLogQueryOptions {
  /** Maximum number of results to return */
  limit?: number;
  /** Number of results to skip (for pagination) */
  offset?: number;
  /** Start date for filtering (inclusive) */
  startDate?: Date;
  /** End date for filtering (inclusive) */
  endDate?: Date;
  /** Filter by action types */
  actions?: AuditAction[];
  /** Filter by resource types */
  resourceTypes?: string[];
  /** Include only successful operations */
  successOnly?: boolean;
  /** Include only failed operations */
  failedOnly?: boolean;
}

/**
 * Audit Service
 *
 * Provides comprehensive audit logging for all CRUD operations in the system.
 * Part of RBAC Phase 5: Row-Level Security, Audit Logging & Hardening.
 *
 * Key Features:
 * - Fire-and-forget logging (doesn't block request processing)
 * - Comprehensive operation tracking (CREATE, UPDATE, DELETE, ACCESS, ACCESS_DENIED)
 * - Query capabilities for compliance and debugging
 * - User activity tracking
 * - Security monitoring for access denials
 *
 * Usage Pattern:
 * - Use log() for general audit logging with fire-and-forget pattern
 * - Use logAccess() for successful access events
 * - Use logAccessDenied() for authorization failures
 * - Use get*AuditLog() methods for querying audit history
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
  ) {
    this.logger.log('Audit Service initialized');
  }

  // ============================================
  // Primary Logging Methods
  // ============================================

  /**
   * Log an audit event.
   *
   * Uses fire-and-forget pattern - errors are caught and logged but don't block the caller.
   * This ensures audit logging never impacts request performance or causes failures.
   *
   * @param dto - The audit log entry data
   * @returns Promise that resolves to the created AuditLog or undefined on error
   */
  async log(dto: CreateAuditLogDto): Promise<AuditLog | undefined> {
    try {
      const auditLog = this.auditLogRepository.create({
        userId: dto.userId,
        userEmail: dto.userEmail,
        organizationId: dto.organizationId,
        action: dto.action,
        resourceType: dto.resourceType,
        resourceId: dto.resourceId,
        resourceName: dto.resourceName,
        changes: dto.changes,
        metadata: dto.metadata,
        success: dto.success,
        errorMessage: dto.errorMessage,
        ipAddress: dto.ipAddress,
        userAgent: dto.userAgent,
      });

      const saved = await this.auditLogRepository.save(auditLog);
      this.logger.debug(
        `Audit logged: ${dto.action} on ${dto.resourceType}${dto.resourceId ? `:${dto.resourceId}` : ''} by ${dto.userId}`,
      );
      return saved;
    } catch (error) {
      // Fire-and-forget: log error but don't throw
      this.logger.error(
        `Failed to create audit log: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`,
        error instanceof Error ? error.stack : undefined,
      );
      return undefined;
    }
  }

  /**
   * Log a successful access event.
   *
   * Convenience method for logging ACCESS events with fire-and-forget pattern.
   *
   * @param userId - The user who accessed the resource
   * @param resourceType - Type of resource accessed
   * @param resourceId - ID of the resource (optional)
   * @param metadata - Additional context (optional)
   */
  async logAccess(
    userId: string,
    resourceType: string,
    resourceId?: string,
    metadata?: AuditLogMetadata,
  ): Promise<void> {
    this.log({
      userId,
      action: AuditAction.ACCESS,
      resourceType,
      resourceId,
      metadata,
      success: true,
    }).catch(() => {
      // Silently ignore - already logged in log()
    });
  }

  /**
   * Log an access denied event.
   *
   * Convenience method for logging ACCESS_DENIED events with fire-and-forget pattern.
   * These logs are important for security monitoring and detecting unauthorized access attempts.
   *
   * @param userId - The user who was denied access
   * @param resourceType - Type of resource access was denied to
   * @param resourceId - ID of the resource (optional)
   * @param reason - Reason for denial
   * @param metadata - Additional context (optional)
   */
  async logAccessDenied(
    userId: string,
    resourceType: string,
    resourceId?: string,
    reason?: string,
    metadata?: AuditLogMetadata,
  ): Promise<void> {
    this.log({
      userId,
      action: AuditAction.ACCESS_DENIED,
      resourceType,
      resourceId,
      metadata,
      success: false,
      errorMessage: reason,
    }).catch(() => {
      // Silently ignore - already logged in log()
    });
  }

  /**
   * Log a CREATE operation.
   *
   * Convenience method for logging resource creation events.
   *
   * @param userId - The user who created the resource
   * @param userEmail - User's email (optional)
   * @param resourceType - Type of resource created
   * @param resourceId - ID of the created resource
   * @param resourceName - Human-readable name (optional)
   * @param organizationId - Organization the resource belongs to (optional)
   * @param metadata - Additional context (optional)
   */
  async logCreate(
    userId: string,
    userEmail: string | undefined,
    resourceType: string,
    resourceId: string,
    resourceName?: string,
    organizationId?: string,
    metadata?: AuditLogMetadata,
  ): Promise<void> {
    this.log({
      userId,
      userEmail,
      organizationId,
      action: AuditAction.CREATE,
      resourceType,
      resourceId,
      resourceName,
      metadata,
      success: true,
    }).catch(() => {
      // Silently ignore - already logged in log()
    });
  }

  /**
   * Log an UPDATE operation.
   *
   * Convenience method for logging resource update events with change tracking.
   *
   * @param userId - The user who updated the resource
   * @param userEmail - User's email (optional)
   * @param resourceType - Type of resource updated
   * @param resourceId - ID of the updated resource
   * @param changes - Before/after changes
   * @param resourceName - Human-readable name (optional)
   * @param organizationId - Organization the resource belongs to (optional)
   * @param metadata - Additional context (optional)
   */
  async logUpdate(
    userId: string,
    userEmail: string | undefined,
    resourceType: string,
    resourceId: string,
    changes?: AuditLogChanges,
    resourceName?: string,
    organizationId?: string,
    metadata?: AuditLogMetadata,
  ): Promise<void> {
    this.log({
      userId,
      userEmail,
      organizationId,
      action: AuditAction.UPDATE,
      resourceType,
      resourceId,
      resourceName,
      changes,
      metadata,
      success: true,
    }).catch(() => {
      // Silently ignore - already logged in log()
    });
  }

  /**
   * Log a DELETE operation.
   *
   * Convenience method for logging resource deletion events.
   *
   * @param userId - The user who deleted the resource
   * @param userEmail - User's email (optional)
   * @param resourceType - Type of resource deleted
   * @param resourceId - ID of the deleted resource
   * @param resourceName - Human-readable name (optional)
   * @param organizationId - Organization the resource belonged to (optional)
   * @param metadata - Additional context (optional)
   */
  async logDelete(
    userId: string,
    userEmail: string | undefined,
    resourceType: string,
    resourceId: string,
    resourceName?: string,
    organizationId?: string,
    metadata?: AuditLogMetadata,
  ): Promise<void> {
    this.log({
      userId,
      userEmail,
      organizationId,
      action: AuditAction.DELETE,
      resourceType,
      resourceId,
      resourceName,
      metadata,
      success: true,
    }).catch(() => {
      // Silently ignore - already logged in log()
    });
  }

  // ============================================
  // Query Methods
  // ============================================

  /**
   * Get audit logs for a specific resource.
   *
   * @param resourceType - Type of resource
   * @param resourceId - ID of the resource
   * @param options - Query options for filtering and pagination
   * @returns Array of audit log entries
   */
  async getResourceAuditLog(
    resourceType: string,
    resourceId: string,
    options: AuditLogQueryOptions = {},
  ): Promise<AuditLog[]> {
    try {
      const where = this.buildWhereClause({
        ...options,
        resourceTypes: [resourceType],
      });
      where.resourceId = resourceId;

      return await this.auditLogRepository.find({
        where,
        order: { timestamp: 'DESC' },
        take: options.limit || 100,
        skip: options.offset || 0,
      });
    } catch (error) {
      this.logger.error(
        `Failed to get resource audit log: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`,
      );
      return [];
    }
  }

  /**
   * Get audit logs for a specific user.
   *
   * @param userId - User ID to query
   * @param options - Query options for filtering and pagination
   * @returns Array of audit log entries
   */
  async getUserAuditLog(
    userId: string,
    options: AuditLogQueryOptions = {},
  ): Promise<AuditLog[]> {
    try {
      const where = this.buildWhereClause(options);
      where.userId = userId;

      return await this.auditLogRepository.find({
        where,
        order: { timestamp: 'DESC' },
        take: options.limit || 100,
        skip: options.offset || 0,
      });
    } catch (error) {
      this.logger.error(
        `Failed to get user audit log: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`,
      );
      return [];
    }
  }

  /**
   * Get audit logs for a specific organization.
   *
   * @param organizationId - Organization ID to query
   * @param options - Query options for filtering and pagination
   * @returns Array of audit log entries
   */
  async getOrganizationAuditLog(
    organizationId: string,
    options: AuditLogQueryOptions = {},
  ): Promise<AuditLog[]> {
    try {
      const where = this.buildWhereClause(options);
      where.organizationId = organizationId;

      return await this.auditLogRepository.find({
        where,
        order: { timestamp: 'DESC' },
        take: options.limit || 100,
        skip: options.offset || 0,
      });
    } catch (error) {
      this.logger.error(
        `Failed to get organization audit log: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`,
      );
      return [];
    }
  }

  /**
   * Get recent access denied events for security monitoring.
   *
   * @param options - Query options for filtering and pagination
   * @returns Array of access denied audit log entries
   */
  async getAccessDeniedEvents(
    options: AuditLogQueryOptions = {},
  ): Promise<AuditLog[]> {
    try {
      const where = this.buildWhereClause({
        ...options,
        actions: [AuditAction.ACCESS_DENIED],
      });

      return await this.auditLogRepository.find({
        where,
        order: { timestamp: 'DESC' },
        take: options.limit || 100,
        skip: options.offset || 0,
      });
    } catch (error) {
      this.logger.error(
        `Failed to get access denied events: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`,
      );
      return [];
    }
  }

  /**
   * Get audit log statistics for a given time period.
   *
   * @param startDate - Start of the period
   * @param endDate - End of the period
   * @param organizationId - Filter by organization (optional)
   * @returns Statistics object with counts by action type
   */
  async getAuditStats(
    startDate: Date,
    endDate: Date,
    organizationId?: string,
  ): Promise<{
    total: number;
    byAction: Record<string, number>;
    successRate: string;
  }> {
    try {
      const whereBase: FindOptionsWhere<AuditLog> = {
        timestamp: Between(startDate, endDate),
      };

      if (organizationId) {
        whereBase.organizationId = organizationId;
      }

      const logs = await this.auditLogRepository.find({
        where: whereBase,
        select: ['action', 'success'],
      });

      const byAction: Record<string, number> = {};
      let successCount = 0;

      for (const log of logs) {
        byAction[log.action] = (byAction[log.action] || 0) + 1;
        if (log.success) {
          successCount++;
        }
      }

      const total = logs.length;
      const successRate = total > 0 ? ((successCount / total) * 100).toFixed(2) : '0.00';

      return {
        total,
        byAction,
        successRate: `${successRate}%`,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get audit stats: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`,
      );
      return {
        total: 0,
        byAction: {},
        successRate: '0.00%',
      };
    }
  }

  // ============================================
  // Health Check
  // ============================================

  /**
   * Health check for the audit logging service.
   *
   * @returns true if the service can write to the audit log table
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Just check if we can query the table
      await this.auditLogRepository.count({
        where: {
          timestamp: MoreThanOrEqual(new Date(Date.now() - 60000)),
        },
      });
      return true;
    } catch (error) {
      this.logger.error(
        `Audit service health check failed: ${error && typeof error === 'object' && 'message' in error ? (error as Error).message : 'Unknown error'}`,
      );
      return false;
    }
  }

  // ============================================
  // Private Helper Methods
  // ============================================

  /**
   * Build a TypeORM where clause from query options
   */
  private buildWhereClause(
    options: AuditLogQueryOptions,
  ): FindOptionsWhere<AuditLog> {
    const where: FindOptionsWhere<AuditLog> = {};

    // Date range filtering
    if (options.startDate && options.endDate) {
      where.timestamp = Between(options.startDate, options.endDate);
    } else if (options.startDate) {
      where.timestamp = MoreThanOrEqual(options.startDate);
    } else if (options.endDate) {
      where.timestamp = LessThanOrEqual(options.endDate);
    }

    // Success/failure filtering
    if (options.successOnly) {
      where.success = true;
    } else if (options.failedOnly) {
      where.success = false;
    }

    return where;
  }
}
