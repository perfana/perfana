import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '../../common/common.module';
import { DeepLinksController } from './deep-links.controller';
import { DeepLinksService } from './deep-links.service';
import { DeepLinksRepository } from './deep-links.repository';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { TestRunsModule } from '../test-runs/test-runs.module';
import { DeepLink, GenericDeepLink, TestRunConfiguration, TestRun, SystemUnderTest, Profile } from '../../entities';

@Module({
  imports: [
    TypeOrmModule.forFeature([DeepLink, GenericDeepLink, TestRunConfiguration, TestRun, SystemUnderTest, Profile]),
    CommonModule, // Provides AuthorizationService for RBAC
    ApiKeysModule,
    TestRunsModule
  ],
  controllers: [DeepLinksController],
  providers: [DeepLinksService, DeepLinksRepository],
  exports: [DeepLinksService],
})
export class DeepLinksModule {}