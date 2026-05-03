import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PyroscopeInstancesController } from './pyroscope-instances.controller';
import { PyroscopeInstancesService } from './pyroscope-instances.service';
import { PyroscopeUrlController } from './pyroscope-url.controller';
import { PyroscopeUrlService } from './pyroscope-url.service';
import { PyroscopeAnalysisService } from './pyroscope-analysis.service';
import { PyroscopeInstance } from '../../entities';
import { CommonModule } from '../../common/common.module';
import { AuditModule } from '../audit/audit.module';
import { AuditResourceRegistry } from '../audit/audit-resource-registry';

@Module({
  imports: [
    TypeOrmModule.forFeature([PyroscopeInstance]),
    CommonModule,
    AuditModule, // Phase 5a: provides AuditService + AuditResourceRegistry
  ],
  controllers: [
    PyroscopeInstancesController,
    PyroscopeUrlController
  ],
  providers: [
    PyroscopeInstancesService,
    PyroscopeUrlService,
    PyroscopeAnalysisService
  ],
  exports: [
    PyroscopeInstancesService,
    PyroscopeUrlService,
    PyroscopeAnalysisService
  ],
})
export class PyroscopeModule implements OnModuleInit {
  constructor(private readonly auditRegistry: AuditResourceRegistry) {}

  onModuleInit(): void {
    this.auditRegistry.register('pyroscope-instances', PyroscopeInstance);
  }
}
