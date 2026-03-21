import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BenchmarkResultsController } from './benchmark-results.controller';
import { BenchmarksModule } from '../benchmarks/benchmarks.module';
import { Benchmark } from '../../entities';
import { TestRun } from '../../entities';
import { ApplicationDashboard } from '../../entities';

@Module({
  imports: [
    TypeOrmModule.forFeature([Benchmark, TestRun, ApplicationDashboard]),
    BenchmarksModule,
  ],
  controllers: [BenchmarkResultsController],
})
export class BenchmarkResultsModule {}
