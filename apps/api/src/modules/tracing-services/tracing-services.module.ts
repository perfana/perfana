import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TracingService, SystemUnderTest } from '@perfana/shared/entities';
import { TracingServicesController } from './tracing-services.controller';
import { TracingServicesService } from './tracing-services.service';
import { TracingServiceRepository } from '../../repositories/tracing-service.repository';
import { CommonModule } from '../../common/common.module';
import { AuditModule } from '../audit/audit.module';
import { AuditResourceRegistry } from '../audit/audit-resource-registry';

@Module({
  imports: [
    TypeOrmModule.forFeature([TracingService, SystemUnderTest]),
    CommonModule,
    AuditModule,
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
