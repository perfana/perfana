import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfluenceConfig, GeneratedReport, SystemUnderTest } from '../../entities';
import { CommonModule } from '../../common/common.module';
import { AuditModule } from '../audit/audit.module';
import { AuditResourceRegistry } from '../audit/audit-resource-registry';
import { ProxyModule } from '../proxy/proxy.module';
import { ReportsModule } from '../reports/reports.module';
import { ConfluenceController } from './confluence.controller';
import { ConfluenceService } from './confluence.service';
import { ConfluenceRenderClient } from './confluence-render.client';

@Module({
  imports: [TypeOrmModule.forFeature([ConfluenceConfig, GeneratedReport, SystemUnderTest]), CommonModule, AuditModule, ProxyModule, ReportsModule],
  controllers: [ConfluenceController],
  providers: [ConfluenceService, ConfluenceRenderClient],
})
export class ConfluenceModule implements OnModuleInit {
  constructor(private readonly auditRegistry: AuditResourceRegistry) {}

  onModuleInit(): void {
    this.auditRegistry.register('confluence-configs', ConfluenceConfig);
  }
}
