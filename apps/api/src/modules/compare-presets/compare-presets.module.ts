import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ComparePresetsService } from './compare-presets.service';
import { ComparePresetsController } from './compare-presets.controller';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { CommonModule } from '../../common/common.module';
import { CompareFilterPreset, ApplicationDashboard, TestRun } from '../../entities';
import { AuditModule } from '../audit/audit.module';
import { AuditResourceRegistry } from '../audit/audit-resource-registry';

@Module({
  imports: [
    TypeOrmModule.forFeature([CompareFilterPreset, ApplicationDashboard, TestRun]),
    ApiKeysModule,
    CommonModule,
    AuditModule, // Phase 5a: provides AuditService + AuditResourceRegistry
  ],
  controllers: [ComparePresetsController],
  providers: [ComparePresetsService],
  exports: [ComparePresetsService]
})
export class ComparePresetsModule implements OnModuleInit {
  constructor(private readonly auditRegistry: AuditResourceRegistry) {}

  onModuleInit(): void {
    this.auditRegistry.register('compare-presets', CompareFilterPreset);
  }
}
