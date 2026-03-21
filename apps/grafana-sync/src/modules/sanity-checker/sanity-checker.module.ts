import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TestRunSanityCheckerService } from './test-run-sanity-checker.service';
import { GeneralSanityCheckerService } from './general-sanity-checker.service';
import { TestRun, Benchmark } from '@perfana/shared/entities';

/**
 * SanityCheckerModule
 *
 * Performs periodic sanity checks on system data.
 * - Test runs: Check for stuck/long-running tests
 * - General: Database integrity, orphaned records, etc.
 */
@Module({
  imports: [TypeOrmModule.forFeature([TestRun, Benchmark])],
  providers: [TestRunSanityCheckerService, GeneralSanityCheckerService],
})
export class SanityCheckerModule {}
