import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdaptController } from './adapt.controller';
import { AdaptService } from './adapt.service';
import { DsAdaptTrackedResults, DsAdaptConclusion, DsAdaptResults, TestRun, DsMetrics } from '../../entities';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [
    CommonModule,
    TypeOrmModule.forFeature([
      DsAdaptTrackedResults,
      DsAdaptConclusion,
      DsAdaptResults,
      TestRun,
      DsMetrics
    ])
  ],
  controllers: [AdaptController],
  providers: [AdaptService],
  exports: [AdaptService],
})
export class AdaptModule {}