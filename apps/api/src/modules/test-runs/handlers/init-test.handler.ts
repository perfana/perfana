/**
 * Handler for InitTestCommand
 *
 * Executes the business logic for initializing a new test run ID.
 * Generates unique test run IDs based on system/environment/workload.
 * Extracted from TestRunsMutationService for better separation of concerns.
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TestRun as TestRunEntity } from '../../../entities';
import { ValidationException } from '../../../common/exceptions/business.exception';
import { InitTestDto, InitTestResponse } from '../dto/init-test.dto';
import { TestRunLookupService } from '../services/test-run-lookup.service';
import safeRegex from 'safe-regex';

@Injectable()
export class InitTestHandler {
  private readonly logger = new Logger(InitTestHandler.name);

  constructor(
    @InjectRepository(TestRunEntity)
    private readonly testRunRepo: Repository<TestRunEntity>,
    private readonly lookupService: TestRunLookupService,
  ) {}

  async execute(initDto: InitTestDto, userId: string, organizationId: string): Promise<InitTestResponse> {
    this.logger.debug(`execute: system=${initDto.systemUnderTest}, userId=${userId}, organizationId=${organizationId}`);

    try {
      let counter = 1;

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

      const testRuns = await this.testRunRepo
        .createQueryBuilder('tr')
        .select('tr.testRunId')
        .where('tr.systemUnderTestId = :systemId', { systemId: systemUnderTest.id })
        .andWhere('tr.testEnvironment = :environment', { environment: initDto.testEnvironment })
        .andWhere('tr.workload = :workload', { workload: initDto.workload })
        .andWhere('tr.testRunId LIKE :pattern', {
          pattern: `${initDto.systemUnderTest}-${initDto.testEnvironment}-${initDto.workload}-%`,
        })
        .orderBy('tr.testRunId', 'DESC')
        .limit(100)
        .getMany();

      if (testRuns.length > 0) {
        const regex = new RegExp(testRunPattern);
        let highestCounter = 0;

        for (const testRun of testRuns) {
          if (regex.test(testRun.testRunId)) {
            const testRunParts = testRun.testRunId.split('-');
            const counterPart = testRunParts[testRunParts.length - 1];
            const currentCounter = parseInt(counterPart ?? '0', 10);
            if (currentCounter > highestCounter) {
              highestCounter = currentCounter;
            }
          }
        }

        counter = highestCounter + 1;
      }

      const formattedCounter = counter.toString().padStart(5, '0');
      const testRunId = `${initDto.systemUnderTest}-${initDto.testEnvironment}-${initDto.workload}-${formattedCounter}`;

      this.logger.log(`Generated test run ID: ${testRunId}`);
      return { testRunId };
    } catch (error) {
      this.logger.error('Failed to initialize test:', error);
      throw error;
    }
  }
}
