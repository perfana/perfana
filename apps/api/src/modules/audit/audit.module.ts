import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from '@perfana/shared/entities';
import { AuditService } from './audit.service';
import { AuditResourceRegistry } from './audit-resource-registry';
import { AuditQueryController } from './audit-query.controller';
import { CommonModule } from '../../common/common.module';

/**
 * AuditModule (Phase 5a)
 *
 * Provides AuditService for service-layer audit calls (logCreate/Update/Delete)
 * and findByFilter/findByResource queries used by the read endpoints.
 *
 * Request-context envelope (userId, IP, UA, requestId) is read from ClsService;
 * RequestContextModule must be imported in the host application module.
 *
 * AuditResourceRegistry is the resource_type → entity class lookup populated by
 * each domain module's onModuleInit (lands in PR5+).
 */
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog]), CommonModule],
  controllers: [AuditQueryController],
  providers: [AuditService, AuditResourceRegistry],
  exports: [AuditService, AuditResourceRegistry],
})
export class AuditModule {}
