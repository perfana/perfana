import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GraphPreset } from '@perfana/shared/entities';
import { GraphPresetsController } from './graph-presets.controller';
import { GraphPresetsService } from './graph-presets.service';
import { CommonModule } from '../../common/common.module';
import { TestRun } from '../../entities';
import { AuditModule } from '../audit/audit.module';
import { AuditResourceRegistry } from '../audit/audit-resource-registry';

@Module({
  imports: [
    TypeOrmModule.forFeature([GraphPreset, TestRun]),
    CommonModule, // Import for AuthorizationService
    AuditModule, // Phase 5a: provides AuditService + AuditResourceRegistry
  ],
  controllers: [GraphPresetsController],
  providers: [GraphPresetsService],
  exports: [GraphPresetsService]
})
export class GraphPresetsModule implements OnModuleInit {
  constructor(private readonly auditRegistry: AuditResourceRegistry) {}

  onModuleInit(): void {
    this.auditRegistry.register('graph-presets', GraphPreset);
  }
}
