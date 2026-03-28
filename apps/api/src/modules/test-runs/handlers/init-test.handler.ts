/**
 * Handler for InitTestCommand
 *
 * Executes the business logic for initializing a new test run ID.
 * Generates unique test run IDs based on system/environment/workload.
 * Extracted from TestRunsMutationService for better separation of concerns.
 */

import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ValidationException } from '../../../common/exceptions/business.exception';
import { InitTestDto, InitTestResponse } from '../dto/init-test.dto';
import { TestRunLookupService } from '../services/test-run-lookup.service';
import safeRegex from 'safe-regex';

@Injectable()
export class InitTestHandler {
  private readonly logger = new Logger(InitTestHandler.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly lookupService: TestRunLookupService,
  ) {}

  async execute(initDto: InitTestDto, userId: string, organizationId: string): Promise<InitTestResponse> {
    this.logger.debug(`execute: system=${initDto.systemUnderTest}, userId=${userId}, organizationId=${organizationId}`);

    try {
      const testRunPattern = `^${initDto.systemUnderTest}-${initDto.testEnvironment}-${initDto.workload}-[0-9]+$`;

      if (!safeRegex(testRunPattern)) {
        throw new ValidationException('Malicious regex detected in test run pattern');
      }

      // Find or create system under test so subsequent API calls (e.g. /api/config/keys) work
      const systemUnderTest = await this.lookupService.findOrCreateSystemUnderTest(
        initDto.systemUnderTest,
        userId,
        organizationId,
      );

      // Use a single atomic SQL query to find the highest counter.
      // Extracts the numeric suffix, casts to integer, and computes MAX.
      // This avoids: (1) lexicographic sort issues with counters > 99999,
      // (2) limit(100) missing higher counters in gaps, (3) race conditions
      // where two concurrent /api/init calls both read the same max.
      const prefix = `${initDto.systemUnderTest}-${initDto.testEnvironment}-${initDto.workload}-`;
      const result = await this.dataSource.query(
        `SELECT COALESCE(MAX(
           CAST(SUBSTRING(test_run_id FROM LENGTH($1) + 1) AS INTEGER)
         ), 0) AS max_counter
         FROM test_runs
         WHERE system_under_test_id = $2
           AND test_environment = $3
           AND workload = $4
           AND test_run_id LIKE $5`,
        [prefix, systemUnderTest.id, initDto.testEnvironment, initDto.workload, `${prefix}%`],
      );

      const counter = (result[0]?.max_counter ?? 0) + 1;
      const formattedCounter = counter.toString().padStart(5, '0');
      const testRunId = `${prefix}${formattedCounter}`;

      this.logger.log(`Generated test run ID: ${testRunId}`);
      return { testRunId };
    } catch (error) {
      this.logger.error('Failed to initialize test:', error);
      throw error;
    }
  }
}
