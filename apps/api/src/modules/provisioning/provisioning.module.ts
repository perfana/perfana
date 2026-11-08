import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Organization,
  Profile,
  ProfileGrafanaDashboard,
  ProfileBenchmark,
  ProvisionedTemplateDsCompareConfig,
} from '../../entities';
import { CommonModule } from '../../common/common.module';
import { AuditModule } from '../audit/audit.module';
import { ProvisioningService } from './provisioning.service';
import { CompareTemplatesService } from './compare-templates.service';
import { CompareTemplatesController, ProvisioningExportController } from './compare-templates.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Organization,
      Profile,
      ProfileGrafanaDashboard,
      ProfileBenchmark,
      ProvisionedTemplateDsCompareConfig,
    ]),
    CommonModule, // AuthorizationService
    AuditModule, // AuditService
  ],
  controllers: [CompareTemplatesController, ProvisioningExportController],
  providers: [ProvisioningService, CompareTemplatesService],
})
export class ProvisioningModule {}
