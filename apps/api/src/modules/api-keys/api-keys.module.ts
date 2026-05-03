import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';
import { ApiKeyCacheService } from './api-key-cache.service';
import { ApiKeyRepository } from '../../repositories/api-key.repository';
import { ApiKey } from '../../entities';
import { QueueModule } from '../queue/queue.module';
import { CommonModule } from '../../common/common.module';
import { AuditModule } from '../audit/audit.module';
import { AuditResourceRegistry } from '../audit/audit-resource-registry';

@Module({
  imports: [
    TypeOrmModule.forFeature([ApiKey]),
    QueueModule, // Import to access Redis client
    CommonModule, // Import for AuthorizationService
    AuditModule, // Phase 5a: provides AuditService + AuditResourceRegistry
  ],
  controllers: [ApiKeysController],
  providers: [ApiKeysService, ApiKeyCacheService, ApiKeyRepository],
  exports: [ApiKeysService, ApiKeyRepository],
})
export class ApiKeysModule implements OnModuleInit {
  constructor(private readonly auditRegistry: AuditResourceRegistry) {}

  onModuleInit(): void {
    this.auditRegistry.register('api-keys', ApiKey);
  }
}