import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TrendsPresetsController } from './trends-presets.controller';
import { TrendsPresetsService } from './trends-presets.service';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { TrendsFilterPreset, ApplicationDashboard, TestRun } from '../../entities';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TrendsFilterPreset, ApplicationDashboard, TestRun]),
    ApiKeysModule,
    CommonModule, // Import for AuthorizationService
  ],
  controllers: [TrendsPresetsController],
  providers: [TrendsPresetsService],
  exports: [TrendsPresetsService]
})
export class TrendsPresetsModule {}