import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { CommonModule } from '../../common/common.module';
import {
  DsMetrics,
  DsMetricStatistics,
  DsControlGroups,
  DsChangePoints,
  DsAdaptResults,
  TestRun,
  Benchmark
} from '../../entities';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DsMetrics,
      DsMetricStatistics,
      DsControlGroups,
      DsChangePoints,
      DsAdaptResults,
      TestRun,
      Benchmark
    ]),
    CommonModule,
  ],
  controllers: [MetricsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}