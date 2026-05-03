import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TracingInstancesController } from './tracing-instances.controller';
import { TracingInstancesService } from './tracing-instances.service';
import { TracingInstance } from '@perfana/shared';
import { CommonModule } from '../../common/common.module';
import { AuditModule } from '../audit/audit.module';
import { AuditResourceRegistry } from '../audit/audit-resource-registry';

@Module({
  imports: [
    TypeOrmModule.forFeature([TracingInstance]),
    CommonModule, // Provides AuthorizationService
    AuditModule, // Phase 5a: provides AuditService + AuditResourceRegistry
  ],
  controllers: [
    TracingInstancesController
  ],
  providers: [
    TracingInstancesService
  ],
  exports: [
    TracingInstancesService
  ],
})
export class TracingInstancesModule implements OnModuleInit {
  constructor(private readonly auditRegistry: AuditResourceRegistry) {}

  onModuleInit(): void {
    this.auditRegistry.register('tracing-instances', TracingInstance);
  }
}
