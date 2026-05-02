import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from '@perfana/shared/entities';
import { AuditService } from './audit.service';

/**
 * AuditModule (Phase 5a)
 *
 * Provides AuditService for service-layer audit calls (logCreate/Update/Delete)
 * and findByFilter/findByResource queries used by the read endpoints.
 *
 * Request-context envelope (userId, IP, UA, requestId) is read from ClsService;
 * RequestContextModule must be imported in the host application module.
 */
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
