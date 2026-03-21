/**
 * TypeORM Column Transformer for Encrypted Columns
 *
 * Provides transparent encryption/decryption for sensitive columns like
 * API keys, passwords, and tokens using AES-256-GCM encryption.
 *
 * Usage in entities:
 * ```typescript
 * @Column({
 *   type: 'text',
 *   nullable: true,
 *   transformer: encryptedColumnTransformer,
 * })
 * apiKey?: string;
 * ```
 *
 * Migration Handling:
 * - Safely handles plaintext values during migration period
 * - Encrypts new values on save, even if old value was plaintext
 * - Logs warnings for decryption failures (does not crash)
 */

import { ValueTransformer } from 'typeorm';
import { encrypt, decrypt, safeDecrypt, isEncrypted } from './encryption';

/**
 * Options for creating encrypted column transformers
 */
export interface EncryptedColumnTransformerOptions {
  /**
   * If true, null/undefined values are stored as-is (not encrypted).
   * Default: true
   */
  allowNull?: boolean;

  /**
   * If true, empty strings are stored as-is (not encrypted).
   * Default: true
   */
  allowEmpty?: boolean;

  /**
   * If true, logs a warning when encryption/decryption fails.
   * Default: true in development, false in production
   */
  logWarnings?: boolean;
}

const defaultOptions: EncryptedColumnTransformerOptions = {
  allowNull: true,
  allowEmpty: true,
};

/**
 * Creates a TypeORM ValueTransformer for encrypted columns.
 *
 * @param options - Configuration options for the transformer
 * @returns ValueTransformer that encrypts on save and decrypts on load
 */
export function createEncryptedColumnTransformer(
  options: EncryptedColumnTransformerOptions = {}
): ValueTransformer {
  // Evaluate logWarnings default at creation time to respect current NODE_ENV
  const opts = {
    ...defaultOptions,
    logWarnings: process.env.NODE_ENV !== 'production',
    ...options,
  };

  return {
    /**
     * Transforms the value before saving to the database.
     * Encrypts plaintext values; already-encrypted values pass through.
     *
     * @param value - The plaintext value to encrypt
     * @returns Encrypted string or null/undefined if allowed
     */
    to(value: string | null | undefined): string | null | undefined {
      // Handle null/undefined
      if (value === null || value === undefined) {
        return opts.allowNull ? value : null;
      }

      // Handle empty strings
      if (value === '') {
        return opts.allowEmpty ? value : null;
      }

      // If already encrypted, pass through (prevents double encryption)
      if (isEncrypted(value)) {
        return value;
      }

      try {
        return encrypt(value);
      } catch (error) {
        // If encryption fails (e.g., missing key), log warning and throw
        // We MUST throw here - saving plaintext when encryption was intended is a security risk
        const errorMessage =
          error && typeof error === 'object' && 'message' in error
            ? (error as Error).message
            : 'Unknown encryption error';

        if (opts.logWarnings) {
          console.error(`Encryption failed: ${errorMessage}`);
        }

        throw new Error(
          `Failed to encrypt column value: ${errorMessage}. ` +
            'Ensure ENCRYPTION_KEY environment variable is set correctly.'
        );
      }
    },

    /**
     * Transforms the value after loading from the database.
     * Decrypts encrypted values; plaintext values pass through (migration support).
     *
     * @param value - The encrypted value from the database
     * @returns Decrypted plaintext or original value if not encrypted
     */
    from(value: string | null | undefined): string | null | undefined {
      // Handle null/undefined
      if (value === null || value === undefined) {
        return value;
      }

      // Handle empty strings
      if (value === '') {
        return value;
      }

      // Use safeDecrypt which handles both encrypted and plaintext values
      // This supports migration scenarios where data may not yet be encrypted
      try {
        return safeDecrypt(value);
      } catch (error) {
        // safeDecrypt should not throw, but handle edge cases gracefully
        const errorMessage =
          error && typeof error === 'object' && 'message' in error
            ? (error as Error).message
            : 'Unknown decryption error';

        if (opts.logWarnings) {
          console.warn(
            `Decryption failed, returning original value: ${errorMessage}`
          );
        }

        // Return original value - don't crash the application
        // This allows the system to continue operating during migration
        return value;
      }
    },
  };
}

/**
 * Default encrypted column transformer instance.
 *
 * Use this for most encrypted column cases:
 * ```typescript
 * @Column({
 *   type: 'text',
 *   nullable: true,
 *   transformer: encryptedColumnTransformer,
 * })
 * password?: string;
 * ```
 */
export const encryptedColumnTransformer: ValueTransformer =
  createEncryptedColumnTransformer();

/**
 * Strict encrypted column transformer that throws on decryption failure.
 *
 * Use when you need to guarantee data integrity and can't accept
 * plaintext fallback during migration:
 * ```typescript
 * @Column({
 *   type: 'text',
 *   transformer: strictEncryptedColumnTransformer,
 * })
 * criticalSecret!: string;
 * ```
 */
export const strictEncryptedColumnTransformer: ValueTransformer = {
  to(value: string | null | undefined): string | null | undefined {
    if (value === null || value === undefined || value === '') {
      return value;
    }

    if (isEncrypted(value)) {
      return value;
    }

    // Encrypt - will throw if ENCRYPTION_KEY is not set
    return encrypt(value);
  },

  from(value: string | null | undefined): string | null | undefined {
    if (value === null || value === undefined || value === '') {
      return value;
    }

    if (!isEncrypted(value)) {
      throw new Error(
        'Value in database is not encrypted but strict transformer was used. ' +
          'Migrate data to encrypted format before using strict transformer.'
      );
    }

    // decrypt - will throw if decryption fails
    return decrypt(value);
  },
};
