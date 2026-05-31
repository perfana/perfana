/**
 * TypeORM Repository Exports
 *
 * These repositories provide type-safe database operations using TypeORM.
 * All repositories extend TypeOrmBaseRepository for consistent patterns.
 */

export { TestRunRepository } from './test-run.repository';
export { TestRunConfigurationRepository } from './test-run-configuration.repository';

/**
 * Usage Example:
 *
 * import { TestRunRepository } from './repositories';
 *
 * @Injectable()
 * export class MyService {
 *   constructor(private testRunRepo: TestRunRepository) {}
 *
 *   async getTestRuns() {
 *     return await this.testRunRepo.findAllWithSystem();
 *   }
 * }
 */
