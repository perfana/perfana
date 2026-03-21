import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from '@perfana/shared/entities';
import { AuditService } from './audit.service';

/**
 * Audit Module
 *
 * Provides comprehensive audit logging capabilities for the Perfana platform.
 * Part of RBAC Phase 5: Row-Level Security, Audit Logging & Hardening.
 *
 * Features:
 * - Fire-and-forget audit logging (doesn't block requests)
 * - Comprehensive operation tracking (CREATE, UPDATE, DELETE, ACCESS, ACCESS_DENIED)
 * - Query capabilities for compliance, debugging, and security monitoring
 * - User activity tracking
 * - Change tracking with before/after snapshots
 *
 * Usage:
 * - Import this module in any module that needs audit logging
 * - Inject AuditService to log operations
 * - Use AuditInterceptor for automatic CRUD logging (registered globally)
 *
 * @example
 * ```typescript
 * // In a service
 * constructor(private readonly auditService: AuditService) {}
 *
 * async createResource(dto: CreateDto, userId: string) {
 *   const resource = await this.repository.save(dto);
 *
 *   // Fire-and-forget logging
 *   this.auditService.logCreate(
 *     userId,
 *     undefined,
 *     'resource',
 *     resource.id,
 *     resource.name,
 *   );
 *
 *   return resource;
 * }
 * ```
 */
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
