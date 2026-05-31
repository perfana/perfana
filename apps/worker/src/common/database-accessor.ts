import { getService } from '../nestjs-bootstrap.js';
import { WorkerDatabaseService } from './database.service.js';

/**
 * Database Service Accessor
 *
 * Provides a convenient way to access the WorkerDatabaseService
 * from anywhere in the worker application (pipelines, services, etc.)
 *
 * Usage:
 * ```typescript
 * import { getDatabaseService } from '../common/database-accessor.js';
 *
 * const db = getDatabaseService();
 * const testRun = await db.getTestRunByTestRunId(testRunId);
 * ```
 */

let cachedService: WorkerDatabaseService | null = null;

/**
 * Get the WorkerDatabaseService instance
 * This uses the NestJS DI container under the hood
 */
export function getDatabaseService(): WorkerDatabaseService {
  if (!cachedService) {
    cachedService = getService(WorkerDatabaseService);
  }
  return cachedService;
}
