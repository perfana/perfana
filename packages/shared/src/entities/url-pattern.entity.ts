import { Entity, Column, PrimaryColumn } from 'typeorm';

/**
 * URL Pattern Entity
 *
 * Stores normalized URL patterns with dynamic segments masked.
 * Used for deduplicating URLs with different IDs, UUIDs, tokens, etc.
 *
 * Example:
 * - Original URLs:
 *   - /api/user/123/profile
 *   - /api/user/456/profile
 *   - /api/user/abc-def-ghi/profile
 *
 * - Normalized URL: /api/user/{id}/profile
 * - URL Hash: MD5 hash of normalized URL
 *
 * This allows grouping similar URLs for better performance metrics analysis.
 */
@Entity('url_patterns')
export class UrlPattern {
  /**
   * MD5 hash of the normalized URL
   * Part of composite primary key
   */
  @PrimaryColumn({ type: 'text' })
  url_hash!: string;

  /**
   * System under test identifier
   * Part of composite primary key
   */
  @PrimaryColumn({ type: 'text' })
  system_under_test!: string;

  /**
   * Test environment identifier
   * Part of composite primary key
   */
  @PrimaryColumn({ type: 'text' })
  test_environment!: string;

  /**
   * URL with dynamic segments replaced by placeholders
   * Examples:
   * - /api/user/{id}
   * - /api/order/{uuid}
   * - /api/resource/{token}
   * - /api/search?query={value}
   */
  @Column({ type: 'text' })
  normalized_url!: string;

  /**
   * First original URL seen that matches this pattern
   * Kept as an example for reference
   */
  @Column({ type: 'text', nullable: true })
  original_example!: string | null;

  /**
   * Timestamp when this URL pattern was first encountered
   */
  @Column({ type: 'timestamptz' })
  first_seen!: Date;
}
