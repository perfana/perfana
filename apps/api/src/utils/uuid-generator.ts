import { createHash } from 'crypto';

/**
 * Generates a deterministic UUID v5-like identifier from a string input.
 * Uses SHA-256 hashing to ensure stability across runs.
 *
 * @param input - The string to generate a UUID from (e.g., "sys-123-prod-loadtest")
 * @returns A UUID string in the format xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 *
 * @example
 * const uuid = generateDeterministicUuid('my-system-prod-loadtest');
 * // Returns: "a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7"
 */
export function generateDeterministicUuid(input: string): string {
  // Create SHA-256 hash of the input
  const hash = createHash('sha256').update(input).digest('hex');

  // Format as UUID: 8-4-4-4-12 hexadecimal characters
  // Use version 5 (SHA-1 based, but we're using SHA-256) indicator in the version field
  const uuid = [
    hash.substring(0, 8),
    hash.substring(8, 12),
    '5' + hash.substring(13, 16), // Version 5 identifier
    ((parseInt(hash.substring(16, 18), 16) & 0x3f) | 0x80).toString(16) + hash.substring(18, 20), // Variant bits
    hash.substring(20, 32),
  ].join('-');

  return uuid;
}
