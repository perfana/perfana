import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';
import {
  Organization,
  Profile,
  ProfileGrafanaDashboard,
  ProfileBenchmark,
  GrafanaInstance,
  GrafanaDashboard,
  GenericDeepLink,
  ProvisionedTemplateDsCompareConfig,
} from '../../entities';
import { CommonModule } from '../../common/common.module';
import { AuditModule } from '../audit/audit.module';
import { AuditResourceRegistry } from '../audit/audit-resource-registry';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Organization, // existence check for a global admin naming an organization on create
      Profile,
      ProfileGrafanaDashboard,
      ProfileBenchmark,
      GrafanaInstance,
      GrafanaDashboard,
      GenericDeepLink,
      ProvisionedTemplateDsCompareConfig,
    ]),
    CommonModule,
    AuditModule, // Phase 5a: provides AuditService + AuditResourceRegistry
  ],
  controllers: [ProfilesController],
  providers: [ProfilesService],
  exports: [ProfilesService],
})
export class ProfilesModule implements OnModuleInit {
  constructor(private readonly auditRegistry: AuditResourceRegistry) {}

  onModuleInit(): void {
    this.auditRegistry.register('profiles', Profile);
    this.auditRegistry.register('profile-dashboards', ProfileGrafanaDashboard);
    this.auditRegistry.register('profile-benchmarks', ProfileBenchmark);
  }
}
