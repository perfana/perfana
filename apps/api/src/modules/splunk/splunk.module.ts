import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MetricsSource, SplunkConfig, SplunkEntityMapping, SplunkQuery, SystemUnderTest } from '../../entities';
import { CommonModule } from '../../common/common.module';
import { AuditModule } from '../audit/audit.module';
import { AuditResourceRegistry } from '../audit/audit-resource-registry';
import { ProxyModule } from '../proxy/proxy.module';
import { SplunkController } from './splunk.controller';
import { SplunkService } from './splunk.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([SplunkConfig, SplunkEntityMapping, SplunkQuery, SystemUnderTest, MetricsSource]),
    CommonModule,
    AuditModule,
    ProxyModule,
  ],
  controllers: [SplunkController],
  providers: [SplunkService],
  exports: [SplunkService],
})
export class SplunkModule implements OnModuleInit {
  constructor(private readonly auditRegistry: AuditResourceRegistry) {}

  onModuleInit(): void {
    this.auditRegistry.register('splunk-configs', SplunkConfig);
    this.auditRegistry.register('splunk-entity-mappings', SplunkEntityMapping);
    this.auditRegistry.register('splunk-queries', SplunkQuery);
  }
}
