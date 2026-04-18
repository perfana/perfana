import { Logger as TypeOrmLogger, QueryRunner } from 'typeorm';

/**
 * Custom TypeORM logger that truncates SQL queries in error messages.
 *
 * TypeORM's default AdvancedConsoleLogger dumps the entire SQL query on error,
 * which can produce enormous log output for batch INSERT statements with
 * hundreds of parameters. This logger truncates queries to a configurable
 * max length while preserving the error message and query summary.
 */
export class TruncatedQueryLogger implements TypeOrmLogger {
  private maxQueryLength: number;
  private logLevel: Set<string>;

  constructor(options?: { maxQueryLength?: number; logging?: string[] | boolean }) {
    this.maxQueryLength = options?.maxQueryLength ?? 200;

    if (options?.logging === true) {
      this.logLevel = new Set(['query', 'error', 'warn', 'info', 'log', 'schema', 'migration']);
    } else if (Array.isArray(options?.logging)) {
      this.logLevel = new Set(options.logging);
    } else {
      this.logLevel = new Set(['error']);
    }
  }

  private truncateQuery(query: string): string {
    if (query.length <= this.maxQueryLength) {
      return query;
    }
    return query.substring(0, this.maxQueryLength) + `... [truncated, total ${query.length} chars]`;
  }

  logQuery(query: string, _parameters?: unknown[], _queryRunner?: QueryRunner): void {
    if (!this.logLevel.has('query')) return;
    console.log(`query: ${this.truncateQuery(query)}`);
  }

  logQueryError(error: string | Error, query: string, _parameters?: unknown[], _queryRunner?: QueryRunner): void {
    if (!this.logLevel.has('error')) return;
    const errorMessage = error instanceof Error ? error.message : error;
    console.error(`query failed: ${this.truncateQuery(query)}`);
    console.error(`error: ${errorMessage}`);
  }

  logQuerySlow(time: number, query: string, _parameters?: unknown[], _queryRunner?: QueryRunner): void {
    if (!this.logLevel.has('warn')) return;
    console.warn(`slow query (${time}ms): ${this.truncateQuery(query)}`);
  }

  logSchemaBuild(message: string, _queryRunner?: QueryRunner): void {
    if (!this.logLevel.has('schema')) return;
    console.log(`schema: ${message}`);
  }

  logMigration(message: string, _queryRunner?: QueryRunner): void {
    if (!this.logLevel.has('migration')) return;
    console.log(`migration: ${message}`);
  }

  log(level: 'log' | 'info' | 'warn', message: unknown, _queryRunner?: QueryRunner): void {
    if (!this.logLevel.has(level)) return;
    switch (level) {
      case 'warn':
        console.warn(message);
        break;
      default:
        console.log(message);
        break;
    }
  }
}
