/**
 * AES-256-GCM Encryption Service
 *
 * Provides secure encryption/decryption for sensitive data at rest.
 * Uses AES-256 in GCM mode for authenticated encryption.
 *
 * Key Requirements:
 * - ENCRYPTION_KEY env var must be 64 hex characters (32 bytes)
 * - Service fails fast if key is missing or invalid
 *
 * Storage Format: iv:authTag:ciphertext (all hex-encoded)
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit for GCM (CRITICAL: must be 12, NOT 16)
const KEY_LENGTH = 32; // 256 bits
const AUTH_TAG_LENGTH = 16; // 128 bits

/**
 * Encrypted data format for storage
 */
export interface EncryptedData {
  iv: string;
  authTag: string;
  ciphertext: string;
}

/**
 * Retrieves and validates the encryption key from environment variables.
 * Fails fast if key is missing or invalid.
 *
 * @throws Error if ENCRYPTION_KEY is not set or invalid
 */
export function getEncryptionKey(): Buffer {
  const keyHex = process.env.ENCRYPTION_KEY;

  if (!keyHex) {
    throw new Error(
      'ENCRYPTION_KEY environment variable is required for credential encryption. ' +
        'Set a 64-character hex string (32 bytes).'
    );
  }

  // Validate hex format
  if (!/^[0-9a-fA-F]+$/.test(keyHex)) {
    throw new Error('ENCRYPTION_KEY must be a valid hexadecimal string.');
  }

  // Validate length (64 hex chars = 32 bytes)
  if (keyHex.length !== KEY_LENGTH * 2) {
    throw new Error(
      `ENCRYPTION_KEY must be ${KEY_LENGTH * 2} hex characters (${KEY_LENGTH} bytes). ` +
        `Got ${keyHex.length} characters.`
    );
  }

  return Buffer.from(keyHex, 'hex');
}

/**
 * Encrypts plaintext using AES-256-GCM.
 *
 * @param plaintext - The text to encrypt
 * @param key - Optional 32-byte encryption key (defaults to ENCRYPTION_KEY env var)
 * @returns Encrypted data as string in format "iv:authTag:ciphertext"
 * @throws Error if encryption fails or key is invalid
 */
export function encrypt(plaintext: string, key?: Buffer): string {
  if (!plaintext) {
    throw new Error('Cannot encrypt empty or null value');
  }

  const encryptionKey = key ?? getEncryptionKey();

  // Generate random 12-byte IV for each encryption
  const iv = randomBytes(IV_LENGTH);

  // Create cipher with authenticated encryption
  const cipher = createCipheriv(ALGORITHM, encryptionKey, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  // Encrypt the plaintext
  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');

  // Get authentication tag for integrity verification
  const authTag = cipher.getAuthTag();

  // Return in format: iv:authTag:ciphertext
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext}`;
}

/**
 * Decrypts ciphertext encrypted with AES-256-GCM.
 *
 * @param encryptedString - Encrypted data in format "iv:authTag:ciphertext"
 * @param key - Optional 32-byte encryption key (defaults to ENCRYPTION_KEY env var)
 * @returns Decrypted plaintext
 * @throws Error if decryption fails, data is tampered, or key is invalid
 */
export function decrypt(encryptedString: string, key?: Buffer): string {
  if (!encryptedString) {
    throw new Error('Cannot decrypt empty or null value');
  }

  const encryptionKey = key ?? getEncryptionKey();

  // Parse the encrypted format
  const parts = encryptedString.split(':');
  if (parts.length !== 3) {
    throw new Error(
      'Invalid encrypted data format. Expected "iv:authTag:ciphertext"'
    );
  }

  const [ivHex, authTagHex, ciphertext] = parts;

  // Validate IV length
  if (ivHex.length !== IV_LENGTH * 2) {
    throw new Error(
      `Invalid IV length. Expected ${IV_LENGTH * 2} hex characters.`
    );
  }

  // Validate auth tag length
  if (authTagHex.length !== AUTH_TAG_LENGTH * 2) {
    throw new Error(
      `Invalid auth tag length. Expected ${AUTH_TAG_LENGTH * 2} hex characters.`
    );
  }

  // Create decipher
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, encryptionKey, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  // Set auth tag BEFORE calling final() - CRITICAL for GCM mode
  const authTag = Buffer.from(authTagHex, 'hex');
  decipher.setAuthTag(authTag);

  // Decrypt the ciphertext
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Checks if a string appears to be encrypted (matches our format).
 * Useful for migration scenarios where data may be plaintext or encrypted.
 *
 * @param value - The string to check
 * @returns true if the value matches encrypted format, false otherwise
 */
export function isEncrypted(value: string): boolean {
  if (!value || typeof value !== 'string') {
    return false;
  }

  const parts = value.split(':');
  if (parts.length !== 3) {
    return false;
  }

  const [ivHex, authTagHex, ciphertext] = parts;

  // Check IV length (12 bytes = 24 hex chars)
  if (ivHex.length !== IV_LENGTH * 2) {
    return false;
  }

  // Check auth tag length (16 bytes = 32 hex chars)
  if (authTagHex.length !== AUTH_TAG_LENGTH * 2) {
    return false;
  }

  // Check all parts are valid hex
  const hexPattern = /^[0-9a-fA-F]+$/;
  return (
    hexPattern.test(ivHex) &&
    hexPattern.test(authTagHex) &&
    hexPattern.test(ciphertext) &&
    ciphertext.length > 0
  );
}

/**
 * Safely decrypts a value, handling both encrypted and plaintext values.
 * Useful during migration when data may not yet be encrypted.
 *
 * @param value - The value to decrypt (may be encrypted or plaintext)
 * @param key - Optional 32-byte encryption key
 * @returns Decrypted value if encrypted, original value if plaintext
 */
export function safeDecrypt(value: string, key?: Buffer): string {
  if (!value) {
    return value;
  }

  if (isEncrypted(value)) {
    try {
      return decrypt(value, key);
    } catch (error) {
      // If decryption fails, value might be plaintext that looks like our format
      // Log warning but return original value
      const errorMessage =
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Unknown error';
      // Plaintext values stored before encryption was enabled — expected during migration
      console.debug(
        `Decryption failed, returning original value: ${errorMessage}`
      );
      return value;
    }
  }

  return value;
}

/**
 * Generates a new encryption key suitable for ENCRYPTION_KEY env var.
 * Useful for initial setup or key rotation.
 *
 * @returns 64-character hex string (32 random bytes)
 */
export function generateEncryptionKey(): string {
  return randomBytes(KEY_LENGTH).toString('hex');
}

/**
 * Masks a credential value for safe logging/display.
 * Shows only the last N characters.
 *
 * @param value - The credential to mask
 * @param visibleChars - Number of characters to show at end (default: 4)
 * @returns Masked string like "****abcd"
 */
export function maskCredential(value: string, visibleChars = 4): string {
  if (!value) {
    return '';
  }

  if (value.length <= visibleChars) {
    return '*'.repeat(value.length);
  }

  const masked = '*'.repeat(Math.min(8, value.length - visibleChars));
  return masked + value.slice(-visibleChars);
}
