/**
 * Type definitions for database operations
 *
 * These types provide proper TypeScript typing for database query parameters
 * and results, replacing the use of `any` types.
 */

/**
 * Valid parameter types for SQL queries
 * These are the types that can be safely passed to PostgreSQL queries
 */
export type SqlParameter = string | number | boolean | null | undefined | Date | Buffer;

/**
 * Array of SQL parameters
 * Used for parameterized queries to prevent SQL injection
 */
export type QueryParameters = SqlParameter[];

/**
 * Generic query result type
 * Use this when you need a flexible result type for raw SQL queries
 */
export type QueryResult<T = Record<string, unknown>> = T;

/**
 * JSON column value type
 * For JSONB columns in PostgreSQL
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * JSONB object type for PostgreSQL
 */
export type JsonObject = { [key: string]: JsonValue };
