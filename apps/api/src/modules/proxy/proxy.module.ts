import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProxyController } from './proxy.controller';
import { ProxyService } from './proxy.service';
import { CommonModule } from '../../common/common.module';
import { AuditModule } from '../audit/audit.module';
import { AuditResourceRegistry } from '../audit/audit-resource-registry';
import { ProxyServer } from '../../entities';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProxyServer]),
    CommonModule, // Provides AuthorizationService for RBAC
    AuditModule,  // Phase 5a: provides AuditService + AuditResourceRegistry
  ],
  controllers: [ProxyController],
  providers: [ProxyService],
  exports: [ProxyService], // exported for Task 5 resolver
})
export class ProxyModule implements OnModuleInit {
  constructor(private readonly auditRegistry: AuditResourceRegistry) {}

  onModuleInit(): void {
    this.auditRegistry.register('proxy-servers', ProxyServer);
  }
}
