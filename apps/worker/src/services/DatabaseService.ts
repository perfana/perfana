import { Pool, PoolClient } from 'pg';
import { getLogger } from '../lib/utils/logger.js';

const logger = getLogger('database-service');

/**
 * Database Service
 * Provides common database operations and utilities
 */
export class DatabaseService {
  constructor(private db: Pool) {}

  /**
   * Check if TimescaleDB extension is available
   */
  async isTimescaleEnabled(): Promise<boolean> {
    const client = await this.db.connect();

    try {
      const result = await client.query(
        "SELECT * FROM pg_extension WHERE extname = 'timescaledb' LIMIT 1"
      );

      return result.rows.length > 0;
    } catch (error) {
      logger.warn('Failed to check TimescaleDB availability:', error);
      return false;
    } finally {
      client.release();
    }
  }

  /**
   * Get database version information
   */
  async getDatabaseInfo(): Promise<{ version: string; timescaleEnabled: boolean }> {
    const client = await this.db.connect();

    try {
      const versionResult = await client.query('SELECT version()');
      const timescaleEnabled = await this.isTimescaleEnabled();

      return {
        version: versionResult.rows[0]?.version || 'Unknown',
        timescaleEnabled
      };
    } finally {
      client.release();
    }
  }

  /**
   * Execute a query with connection handling
   */
  async query(sql: string, params: any[] = []): Promise<any> {
    const client = await this.db.connect();

    try {
      return await client.query(sql, params);
    } finally {
      client.release();
    }
  }

  /**
   * Execute multiple queries in a transaction
   */
  async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db.connect();

    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Check if required tables exist
   */
  async validateSchema(): Promise<{ valid: boolean; missingTables: string[] }> {
    const requiredTables = [
      'test_runs',
      'ds_panels',
      'ds_metrics',
      'ds_metric_statistics',
      'ds_adapt_results'
    ];

    const missingTables: string[] = [];

    for (const table of requiredTables) {
      const exists = await this.tableExists(table);
      if (!exists) {
        missingTables.push(table);
      }
    }

    return {
      valid: missingTables.length === 0,
      missingTables
    };
  }

  /**
   * Check if a table exists
   */
  private async tableExists(tableName: string): Promise<boolean> {
    try {
      const result = await this.query(
        `SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = $1
        )`,
        [tableName]
      );

      return result.rows[0]?.exists || false;
    } catch (error) {
      logger.warn(`Failed to check if table ${tableName} exists:`, error);
      return false;
    }
  }
}