import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';
import { ApiKeyCacheService } from './api-key-cache.service';
import { ApiKeyRepository } from '../../repositories/api-key.repository';
import { ApiKey } from '../../entities';
import { QueueModule } from '../queue/queue.module';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ApiKey]),
    QueueModule, // Import to access Redis client
    CommonModule, // Import for AuthorizationService
  ],
  controllers: [ApiKeysController],
  providers: [ApiKeysService, ApiKeyCacheService, ApiKeyRepository],
  exports: [ApiKeysService, ApiKeyRepository],
})
export class ApiKeysModule {}