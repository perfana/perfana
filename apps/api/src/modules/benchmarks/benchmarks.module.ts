import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BenchmarksController } from './benchmarks.controller';
import { BenchmarksService } from './benchmarks.service';
import {
  BenchmarkCalculatorService,
  BenchmarkQueryService,
  BenchmarkMutationService,
  BenchmarkTagHelper,
} from './services';
import { CommonModule } from '../../common/common.module';
import { Benchmark, SystemUnderTest, ApplicationDashboard } from '../../entities';

@Module({
  imports: [
    TypeOrmModule.forFeature([Benchmark, SystemUnderTest, ApplicationDashboard]),
    CommonModule,
  ],
  controllers: [BenchmarksController],
  providers: [
    // Query service (handles queries, filtering, and validation)
    BenchmarkQueryService,
    // Calculator service (handles Apdex calculations and thresholds)
    BenchmarkCalculatorService,
    // Tag helper (handles tag inheritance from application dashboards)
    BenchmarkTagHelper,
    // Mutation service (handles create, update, delete operations)
    BenchmarkMutationService,
    // Main facade service (delegates to sub-services)
    BenchmarksService,
  ],
  exports: [
    BenchmarksService,
    BenchmarkCalculatorService,
    BenchmarkQueryService,
    BenchmarkMutationService,
  ],
})
export class BenchmarksModule {}