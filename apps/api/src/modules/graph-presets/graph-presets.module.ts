import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GraphPreset } from '@perfana/shared/entities';
import { GraphPresetsController } from './graph-presets.controller';
import { GraphPresetsService } from './graph-presets.service';
import { CommonModule } from '../../common/common.module';
import { TestRun } from '../../entities';

@Module({
  imports: [
    TypeOrmModule.forFeature([GraphPreset, TestRun]),
    CommonModule, // Import for AuthorizationService
  ],
  controllers: [GraphPresetsController],
  providers: [GraphPresetsService],
  exports: [GraphPresetsService]
})
export class GraphPresetsModule {}
