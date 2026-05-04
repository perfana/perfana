import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SystemsUnderTestController } from './systems-under-test.controller';
import { SystemsUnderTestService } from './systems-under-test.service';
import { DeleteSystemUnderTestHandler } from './handlers/delete-system-under-test.handler';
import { SystemUnderTest, SystemUnderTestTestEnvironment, SystemUnderTestWorkload, TestRun, PyroscopeInstance } from '../../entities';
import { CommonModule } from '../../common/common.module';
import { AuditModule } from '../audit/audit.module';
import { AuditResourceRegistry } from '../audit/audit-resource-registry';

@Module({
  imports: [
    TypeOrmModule.forFeature([SystemUnderTest, SystemUnderTestTestEnvironment, SystemUnderTestWorkload, TestRun, PyroscopeInstance]),
    CommonModule,
    AuditModule, // Phase 5a: provides AuditService + AuditResourceRegistry
  ],
  controllers: [SystemsUnderTestController],
  providers: [SystemsUnderTestService, DeleteSystemUnderTestHandler],
  exports: [SystemsUnderTestService],
})
export class SystemsUnderTestModule implements OnModuleInit {
  constructor(private readonly auditRegistry: AuditResourceRegistry) {}

  onModuleInit(): void {
    // Phase 5a — only `systems-under-test` is registered: the live audit
    // surface is destructive-only on the SUT itself. Environment and Workload
    // entities have `auditableFields` declared but no service-layer log
    // call sites yet, so registering them here would point the per-resource
    // history endpoint at a resource type that never receives audit rows.
    this.auditRegistry.register('systems-under-test', SystemUnderTest);
  }
}
