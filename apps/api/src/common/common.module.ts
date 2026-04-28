import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrganizationMember, TeamMember, Team, ApiKey } from '@perfana/shared/entities';
import { AuthorizationService } from './services/authorization.service';
import { CapabilitiesService } from './services/capabilities.service';
import { QueueModule } from '../modules/queue/queue.module';

/**
 * CommonModule - Shared utilities and common functionality
 *
 * This module provides:
 * - AuthorizationService: Centralized permission checking with Redis caching
 *   for organization/team membership-based access control.
 * - CapabilitiesService: Pure role-to-capability mapping (stateless, no I/O).
 *
 * Note: This module previously contained NativeDatabaseService and DatabaseFactoryService
 * which were deprecated and removed in favor of direct repository usage.
 *
 * Database operations should now use TypeORM repositories directly.
 * For raw SQL needs, inject DataSource from @nestjs/typeorm.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([OrganizationMember, TeamMember, Team, ApiKey]),
    QueueModule, // Provides REDIS_CLIENT for AuthorizationService caching
  ],
  providers: [AuthorizationService, CapabilitiesService],
  exports: [AuthorizationService, CapabilitiesService],
})
export class CommonModule {}
