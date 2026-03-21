/**
 * Unit tests for AES-256-GCM Encryption Service
 *
 * Tests cover:
 * - Key validation and generation
 * - Encryption/decryption correctness
 * - Data format validation
 * - Tampering detection (auth tag verification)
 * - Edge cases and error handling
 * - Migration support (plaintext fallback)
 */

import { randomBytes } from 'crypto';
import {
  encrypt,
  decrypt,
  getEncryptionKey,
  generateEncryptionKey,
  isEncrypted,
  safeDecrypt,
  maskCredential,
} from '../encryption';

describe('Encryption Service', () => {
  // Store original env var
  const originalKey = process.env.ENCRYPTION_KEY;

  // Test key (64 hex chars = 32 bytes)
  const testKey = 'a'.repeat(64);

  beforeEach(() => {
    // Set a valid test key for each test
    process.env.ENCRYPTION_KEY = testKey;
  });

  afterEach(() => {
    // Restore original key
    process.env.ENCRYPTION_KEY = originalKey;
  });

  describe('getEncryptionKey', () => {
    it('should retrieve and validate encryption key from environment', () => {
      const key = getEncryptionKey();
      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32); // 32 bytes
    });

    it('should throw if ENCRYPTION_KEY is not set', () => {
      delete process.env.ENCRYPTION_KEY;
      expect(() => getEncryptionKey()).toThrow(
        'ENCRYPTION_KEY environment variable is required'
      );
    });

    it('should throw if ENCRYPTION_KEY is not hex', () => {
      process.env.ENCRYPTION_KEY = 'not-a-hex-string';
      expect(() => getEncryptionKey()).toThrow(
        'ENCRYPTION_KEY must be a valid hexadecimal string'
      );
    });

    it('should throw if ENCRYPTION_KEY has wrong length', () => {
      process.env.ENCRYPTION_KEY = 'a'.repeat(32); // Too short
      expect(() => getEncryptionKey()).toThrow(
        'ENCRYPTION_KEY must be 64 hex characters (32 bytes)'
      );
    });

    it('should accept valid lowercase hex key', () => {
      process.env.ENCRYPTION_KEY = 'abcdef0123456789'.repeat(4);
      expect(() => getEncryptionKey()).not.toThrow();
    });

    it('should accept valid uppercase hex key', () => {
      process.env.ENCRYPTION_KEY = 'ABCDEF0123456789'.repeat(4);
      expect(() => getEncryptionKey()).not.toThrow();
    });

    it('should accept valid mixed case hex key', () => {
      process.env.ENCRYPTION_KEY = 'AbCdEf0123456789'.repeat(4);
      expect(() => getEncryptionKey()).not.toThrow();
    });
  });

  describe('generateEncryptionKey', () => {
    it('should generate a 64-character hex string', () => {
      const key = generateEncryptionKey();
      expect(key).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/.test(key)).toBe(true);
    });

    it('should generate unique keys', () => {
      const key1 = generateEncryptionKey();
      const key2 = generateEncryptionKey();
      const key3 = generateEncryptionKey();

      expect(key1).not.toBe(key2);
      expect(key2).not.toBe(key3);
      expect(key1).not.toBe(key3);
    });

    it('should generate keys that work for encryption', () => {
      const key = generateEncryptionKey();
      const keyBuffer = Buffer.from(key, 'hex');
      const plaintext = 'test message';

      const encrypted = encrypt(plaintext, keyBuffer);
      const decrypted = decrypt(encrypted, keyBuffer);

      expect(decrypted).toBe(plaintext);
    });
  });

  describe('encrypt', () => {
    it('should encrypt plaintext successfully', () => {
      const plaintext = 'secret message';
      const encrypted = encrypt(plaintext);

      expect(encrypted).toBeTruthy();
      expect(typeof encrypted).toBe('string');
      expect(encrypted).not.toBe(plaintext);
    });

    it('should return different ciphertext for same plaintext (due to random IV)', () => {
      const plaintext = 'secret message';
      const encrypted1 = encrypt(plaintext);
      const encrypted2 = encrypt(plaintext);

      expect(encrypted1).not.toBe(encrypted2);
    });

    it('should use correct format: iv:authTag:ciphertext', () => {
      const plaintext = 'test';
      const encrypted = encrypt(plaintext);
      const parts = encrypted.split(':');

      expect(parts).toHaveLength(3);

      // IV should be 12 bytes = 24 hex chars
      expect(parts[0]).toHaveLength(24);
      expect(/^[0-9a-f]{24}$/.test(parts[0])).toBe(true);

      // Auth tag should be 16 bytes = 32 hex chars
      expect(parts[1]).toHaveLength(32);
      expect(/^[0-9a-f]{32}$/.test(parts[1])).toBe(true);

      // Ciphertext should be hex (length varies with plaintext)
      expect(/^[0-9a-f]+$/.test(parts[2])).toBe(true);
    });

    it('should throw on empty plaintext', () => {
      expect(() => encrypt('')).toThrow('Cannot encrypt empty or null value');
    });

    it('should throw on null plaintext', () => {
      expect(() => encrypt(null as any)).toThrow(
        'Cannot encrypt empty or null value'
      );
    });

    it('should throw on undefined plaintext', () => {
      expect(() => encrypt(undefined as any)).toThrow(
        'Cannot encrypt empty or null value'
      );
    });

    it('should encrypt long text', () => {
      const longText = 'a'.repeat(10000);
      const encrypted = encrypt(longText);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(longText);
    });

    it('should encrypt special characters', () => {
      const specialText = '!@#$%^&*()_+-=[]{}|;:,.<>?';
      const encrypted = encrypt(specialText);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(specialText);
    });

    it('should encrypt unicode characters', () => {
      const unicodeText = '你好世界 🌍 Здравствуй мир';
      const encrypted = encrypt(unicodeText);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(unicodeText);
    });

    it('should work with custom encryption key', () => {
      const customKey = Buffer.from(generateEncryptionKey(), 'hex');
      const plaintext = 'test with custom key';

      const encrypted = encrypt(plaintext, customKey);
      const decrypted = decrypt(encrypted, customKey);

      expect(decrypted).toBe(plaintext);
    });
  });

  describe('decrypt', () => {
    it('should decrypt ciphertext successfully', () => {
      const plaintext = 'secret message';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should throw on empty encrypted string', () => {
      expect(() => decrypt('')).toThrow('Cannot decrypt empty or null value');
    });

    it('should throw on null encrypted string', () => {
      expect(() => decrypt(null as any)).toThrow(
        'Cannot decrypt empty or null value'
      );
    });

    it('should throw on invalid format (missing parts)', () => {
      expect(() => decrypt('invalid')).toThrow(
        'Invalid encrypted data format'
      );
      expect(() => decrypt('only:two')).toThrow(
        'Invalid encrypted data format'
      );
      expect(() => decrypt('too:many:parts:here')).toThrow(
        'Invalid encrypted data format'
      );
    });

    it('should throw on invalid IV length', () => {
      const invalidIV = 'short:' + 'a'.repeat(32) + ':' + 'a'.repeat(8);
      expect(() => decrypt(invalidIV)).toThrow('Invalid IV length');
    });

    it('should throw on invalid auth tag length', () => {
      const invalidTag = 'a'.repeat(24) + ':short:' + 'a'.repeat(8);
      expect(() => decrypt(invalidTag)).toThrow('Invalid auth tag length');
    });

    it('should detect tampered ciphertext (auth tag verification)', () => {
      const plaintext = 'important data';
      const encrypted = encrypt(plaintext);

      // Tamper with ciphertext (change last character)
      const parts = encrypted.split(':');
      const tamperedCiphertext =
        parts[2].slice(0, -1) + (parts[2].slice(-1) === 'a' ? 'b' : 'a');
      const tampered = `${parts[0]}:${parts[1]}:${tamperedCiphertext}`;

      // Decryption should fail due to auth tag mismatch
      expect(() => decrypt(tampered)).toThrow();
    });

    it('should detect tampered auth tag', () => {
      const plaintext = 'important data';
      const encrypted = encrypt(plaintext);

      // Tamper with auth tag
      const parts = encrypted.split(':');
      const tamperedTag =
        parts[1].slice(0, -1) + (parts[1].slice(-1) === 'a' ? 'b' : 'a');
      const tampered = `${parts[0]}:${tamperedTag}:${parts[2]}`;

      // Decryption should fail
      expect(() => decrypt(tampered)).toThrow();
    });

    it('should detect tampered IV', () => {
      const plaintext = 'important data';
      const encrypted = encrypt(plaintext);

      // Tamper with IV
      const parts = encrypted.split(':');
      const tamperedIV =
        parts[0].slice(0, -1) + (parts[0].slice(-1) === 'a' ? 'b' : 'a');
      const tampered = `${tamperedIV}:${parts[1]}:${parts[2]}`;

      // Decryption should fail
      expect(() => decrypt(tampered)).toThrow();
    });

    it('should fail with wrong encryption key', () => {
      const plaintext = 'secret';
      const key1 = Buffer.from(generateEncryptionKey(), 'hex');
      const key2 = Buffer.from(generateEncryptionKey(), 'hex');

      const encrypted = encrypt(plaintext, key1);

      // Try to decrypt with different key
      expect(() => decrypt(encrypted, key2)).toThrow();
    });

    it('should work with custom decryption key', () => {
      const customKey = Buffer.from(generateEncryptionKey(), 'hex');
      const plaintext = 'test with custom key';

      const encrypted = encrypt(plaintext, customKey);
      const decrypted = decrypt(encrypted, customKey);

      expect(decrypted).toBe(plaintext);
    });
  });

  describe('isEncrypted', () => {
    it('should return true for encrypted strings', () => {
      const encrypted = encrypt('test data');
      expect(isEncrypted(encrypted)).toBe(true);
    });

    it('should return false for plaintext', () => {
      expect(isEncrypted('plain text')).toBe(false);
      expect(isEncrypted('not encrypted')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isEncrypted('')).toBe(false);
    });

    it('should return false for null', () => {
      expect(isEncrypted(null as any)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isEncrypted(undefined as any)).toBe(false);
    });

    it('should return false for non-string values', () => {
      expect(isEncrypted(123 as any)).toBe(false);
      expect(isEncrypted({} as any)).toBe(false);
      expect(isEncrypted([] as any)).toBe(false);
    });

    it('should return false for wrong format (too few parts)', () => {
      expect(isEncrypted('only:two')).toBe(false);
    });

    it('should return false for wrong format (too many parts)', () => {
      expect(isEncrypted('too:many:parts:here')).toBe(false);
    });

    it('should return false for wrong IV length', () => {
      const wrongIV = 'short:' + 'a'.repeat(32) + ':' + 'a'.repeat(16);
      expect(isEncrypted(wrongIV)).toBe(false);
    });

    it('should return false for wrong auth tag length', () => {
      const wrongTag = 'a'.repeat(24) + ':short:' + 'a'.repeat(16);
      expect(isEncrypted(wrongTag)).toBe(false);
    });

    it('should return false for non-hex characters', () => {
      const nonHex = 'a'.repeat(24) + ':' + 'z'.repeat(32) + ':' + 'a'.repeat(16);
      expect(isEncrypted(nonHex)).toBe(false);
    });

    it('should return false for empty ciphertext', () => {
      const emptyData = 'a'.repeat(24) + ':' + 'a'.repeat(32) + ':';
      expect(isEncrypted(emptyData)).toBe(false);
    });
  });

  describe('safeDecrypt', () => {
    it('should decrypt encrypted values', () => {
      const plaintext = 'secret';
      const encrypted = encrypt(plaintext);
      const decrypted = safeDecrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should return plaintext values unchanged', () => {
      const plaintext = 'not encrypted';
      const result = safeDecrypt(plaintext);

      expect(result).toBe(plaintext);
    });

    it('should handle empty string', () => {
      expect(safeDecrypt('')).toBe('');
    });

    it('should handle null', () => {
      expect(safeDecrypt(null as any)).toBe(null);
    });

    it('should handle undefined', () => {
      expect(safeDecrypt(undefined as any)).toBe(undefined);
    });

    it('should return original value on decryption failure', () => {
      // Create a value that looks like encrypted format but will fail decryption
      const fakeEncrypted = 'a'.repeat(24) + ':' + 'b'.repeat(32) + ':' + 'c'.repeat(16);

      // Should not throw, just return original value
      const result = safeDecrypt(fakeEncrypted);
      expect(result).toBe(fakeEncrypted);
    });

    it('should work with custom key', () => {
      const customKey = Buffer.from(generateEncryptionKey(), 'hex');
      const plaintext = 'test';
      const encrypted = encrypt(plaintext, customKey);

      const decrypted = safeDecrypt(encrypted, customKey);
      expect(decrypted).toBe(plaintext);
    });
  });

  describe('maskCredential', () => {
    it('should mask credentials with default visible chars (4)', () => {
      const credential = 'secret1234';
      const masked = maskCredential(credential);

      expect(masked).toBe('******1234');
    });

    it('should mask credentials with custom visible chars', () => {
      const credential = 'secret1234';
      const masked = maskCredential(credential, 2);

      expect(masked).toBe('********34');
    });

    it('should handle short credentials', () => {
      const credential = 'abc';
      const masked = maskCredential(credential);

      expect(masked).toBe('***');
    });

    it('should handle empty string', () => {
      expect(maskCredential('')).toBe('');
    });

    it('should cap mask length at 8 characters', () => {
      const longCredential = 'a'.repeat(100);
      const masked = maskCredential(longCredential, 4);

      // Should be 8 asterisks + 4 visible = 12 total
      expect(masked).toBe('********' + 'a'.repeat(4));
    });

    it('should handle credentials exactly matching visible length', () => {
      const credential = '1234';
      const masked = maskCredential(credential, 4);

      // For security, credentials <= visibleChars are fully masked
      expect(masked).toBe('****');
    });

    it('should handle null', () => {
      expect(maskCredential(null as any)).toBe('');
    });

    it('should handle undefined', () => {
      expect(maskCredential(undefined as any)).toBe('');
    });
  });

  describe('End-to-end encryption workflow', () => {
    it('should encrypt and decrypt multiple times correctly', () => {
      const plaintext = 'test data';

      const encrypted1 = encrypt(plaintext);
      const decrypted1 = decrypt(encrypted1);
      expect(decrypted1).toBe(plaintext);

      const encrypted2 = encrypt(decrypted1);
      const decrypted2 = decrypt(encrypted2);
      expect(decrypted2).toBe(plaintext);
    });

    it('should handle batch encryption/decryption', () => {
      const items = [
        'password123',
        'api-key-secret',
        'token-xyz',
        '🔐 secure data',
      ];

      const encrypted = items.map((item) => encrypt(item));
      const decrypted = encrypted.map((item) => decrypt(item));

      expect(decrypted).toEqual(items);
    });

    it('should maintain data integrity through multiple operations', () => {
      const original = 'important data';

      // Encrypt
      const encrypted = encrypt(original);
      expect(isEncrypted(encrypted)).toBe(true);

      // Decrypt
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(original);

      // Re-encrypt
      const reencrypted = encrypt(decrypted);
      expect(isEncrypted(reencrypted)).toBe(true);
      expect(reencrypted).not.toBe(encrypted); // Different IV

      // Decrypt again
      const finalDecrypted = decrypt(reencrypted);
      expect(finalDecrypted).toBe(original);
    });
  });
});
