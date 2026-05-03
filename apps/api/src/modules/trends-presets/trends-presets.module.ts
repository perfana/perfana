import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TrendsPresetsController } from './trends-presets.controller';
import { TrendsPresetsService } from './trends-presets.service';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { TrendsFilterPreset, ApplicationDashboard, TestRun } from '../../entities';
import { CommonModule } from '../../common/common.module';
import { AuditModule } from '../audit/audit.module';
import { AuditResourceRegistry } from '../audit/audit-resource-registry';

@Module({
  imports: [
    TypeOrmModule.forFeature([TrendsFilterPreset, ApplicationDashboard, TestRun]),
    ApiKeysModule,
    CommonModule, // Import for AuthorizationService
    AuditModule, // Phase 5a: provides AuditService + AuditResourceRegistry
  ],
  controllers: [TrendsPresetsController],
  providers: [TrendsPresetsService],
  exports: [TrendsPresetsService]
})
export class TrendsPresetsModule implements OnModuleInit {
  constructor(private readonly auditRegistry: AuditResourceRegistry) {}

  onModuleInit(): void {
    this.auditRegistry.register('trends-presets', TrendsFilterPreset);
  }
}
