import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ComparePresetsService } from './compare-presets.service';
import { ComparePresetsController } from './compare-presets.controller';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { CommonModule } from '../../common/common.module';
import { CompareFilterPreset, ApplicationDashboard, TestRun } from '../../entities';

@Module({
  imports: [
    TypeOrmModule.forFeature([CompareFilterPreset, ApplicationDashboard, TestRun]),
    ApiKeysModule,
    CommonModule
  ],
  controllers: [ComparePresetsController],
  providers: [ComparePresetsService],
  exports: [ComparePresetsService]
})
export class ComparePresetsModule {}