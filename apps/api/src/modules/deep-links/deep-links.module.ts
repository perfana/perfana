import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '../../common/common.module';
import { DeepLinksController } from './deep-links.controller';
import { DeepLinksService } from './deep-links.service';
import { DeepLinksRepository } from './deep-links.repository';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { TestRunsModule } from '../test-runs/test-runs.module';
import { AuditModule } from '../audit/audit.module';
import { AuditResourceRegistry } from '../audit/audit-resource-registry';
import { DeepLink, GenericDeepLink, TestRunConfiguration, TestRun, SystemUnderTest, Profile } from '../../entities';

@Module({
  imports: [
    TypeOrmModule.forFeature([DeepLink, GenericDeepLink, TestRunConfiguration, TestRun, SystemUnderTest, Profile]),
    CommonModule, // Provides AuthorizationService for RBAC
    ApiKeysModule,
    TestRunsModule,
    AuditModule, // Phase 5a: provides AuditService + AuditResourceRegistry
  ],
  controllers: [DeepLinksController],
  providers: [DeepLinksService, DeepLinksRepository],
  exports: [DeepLinksService],
})
export class DeepLinksModule implements OnModuleInit {
  constructor(private readonly auditRegistry: AuditResourceRegistry) {}

  onModuleInit(): void {
    // Phase 5a — only `generic-deep-links` is registered: the live audit
    // surface is full CRUD on profile-scoped GenericDeepLink (currently just
    // create — no service-level update/delete methods exist). Per-test-run
    // DeepLink writes are intentionally non-audited (high-churn ingestion
    // artefact) and URL Pattern is mutated via the JTL ingestion path
    // (POLICY_EXEMPT, PR20), so neither is registered here.
    this.auditRegistry.register('generic-deep-links', GenericDeepLink);
  }
}