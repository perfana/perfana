import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TracingService } from '@perfana/shared/entities';
import { TracingServicesController } from './tracing-services.controller';
import { TracingServicesService } from './tracing-services.service';
import { TracingServiceRepository } from '../../repositories/tracing-service.repository';
import { CommonModule } from '../../common/common.module';
import { AuditModule } from '../audit/audit.module';
import { AuditResourceRegistry } from '../audit/audit-resource-registry';

@Module({
  imports: [
    TypeOrmModule.forFeature([TracingService]),
    CommonModule, // Import for AuthorizationService
    AuditModule, // Phase 5a: provides AuditService + AuditResourceRegistry
  ],
  controllers: [TracingServicesController],
  providers: [TracingServicesService, TracingServiceRepository],
  exports: [TracingServicesService],
})
export class TracingServicesModule implements OnModuleInit {
  constructor(private readonly auditRegistry: AuditResourceRegistry) {}

  onModuleInit(): void {
    this.auditRegistry.register('tracing-services', TracingService);
  }
}
