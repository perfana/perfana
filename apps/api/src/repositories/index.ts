/**
 * TypeORM Repository Exports
 *
 * These repositories provide type-safe database operations using TypeORM.
 * All repositories extend TypeOrmBaseRepository for consistent patterns.
 */

export { TypeOrmBaseRepository } from '../common/repositories/typeorm-base.repository';
export { TestRunRepository } from './test-run.repository';
export { ApiKeyRepository } from './api-key.repository';
export { TestRunConfigurationRepository } from './test-run-configuration.repository';
export { ExpectedConfigChangeRepository } from './expected-config-change.repository';
export { TrendsFilterPresetRepository } from './trends-filter-preset.repository';
export { CompareFilterPresetRepository } from './compare-filter-preset.repository';
export { ApplicationDashboardRepository } from './application-dashboard.repository';
export { TracingServiceRepository } from './tracing-service.repository';

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
