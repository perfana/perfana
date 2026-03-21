/**
 * Unit tests for TypeORM Encrypted Column Transformer
 *
 * Tests cover:
 * - Value transformation (to/from database)
 * - Migration support (plaintext to encrypted)
 * - Double encryption prevention
 * - Null and empty value handling
 * - Error handling and logging
 * - Strict vs lenient modes
 */

import { ValueTransformer } from 'typeorm';
import {
  createEncryptedColumnTransformer,
  encryptedColumnTransformer,
  strictEncryptedColumnTransformer,
} from '../encrypted-column.transformer';
import { encrypt, isEncrypted, generateEncryptionKey } from '../encryption';

describe('Encrypted Column Transformer', () => {
  // Store original env var and console methods
  const originalKey = process.env.ENCRYPTION_KEY;
  const originalError = console.error;
  const originalWarn = console.warn;

  // Test key
  const testKey = 'a'.repeat(64);

  // Mock console methods
  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = testKey;
    process.env.NODE_ENV = 'test';

    // Mock console methods
    errorSpy = jest.spyOn(console, 'error').mockImplementation();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation();
  });

  afterEach(() => {
    process.env.ENCRYPTION_KEY = originalKey;
    delete process.env.NODE_ENV;

    // Restore console methods
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  afterAll(() => {
    console.error = originalError;
    console.warn = originalWarn;
  });

  describe('encryptedColumnTransformer (default instance)', () => {
    it('should be a ValueTransformer', () => {
      expect(encryptedColumnTransformer).toHaveProperty('to');
      expect(encryptedColumnTransformer).toHaveProperty('from');
      expect(typeof encryptedColumnTransformer.to).toBe('function');
      expect(typeof encryptedColumnTransformer.from).toBe('function');
    });

    it('should encrypt plaintext when saving to database', () => {
      const plaintext = 'my-secret-api-key';
      const encrypted = encryptedColumnTransformer.to(plaintext);

      expect(encrypted).toBeTruthy();
      expect(encrypted).not.toBe(plaintext);
      expect(isEncrypted(encrypted as string)).toBe(true);
    });

    it('should decrypt encrypted value when loading from database', () => {
      const plaintext = 'my-secret-password';
      const encrypted = encrypt(plaintext);

      const decrypted = encryptedColumnTransformer.from(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle round-trip encryption/decryption', () => {
      const original = 'test-credential';

      const encrypted = encryptedColumnTransformer.to(original) as string;
      const decrypted = encryptedColumnTransformer.from(encrypted);

      expect(decrypted).toBe(original);
    });

    it('should handle null values', () => {
      expect(encryptedColumnTransformer.to(null)).toBe(null);
      expect(encryptedColumnTransformer.from(null)).toBe(null);
    });

    it('should handle undefined values', () => {
      expect(encryptedColumnTransformer.to(undefined)).toBe(undefined);
      expect(encryptedColumnTransformer.from(undefined)).toBe(undefined);
    });

    it('should handle empty strings', () => {
      expect(encryptedColumnTransformer.to('')).toBe('');
      expect(encryptedColumnTransformer.from('')).toBe('');
    });

    it('should prevent double encryption', () => {
      const plaintext = 'test';

      // Encrypt once
      const encrypted1 = encryptedColumnTransformer.to(plaintext) as string;
      expect(isEncrypted(encrypted1)).toBe(true);

      // Try to encrypt again - should pass through
      const encrypted2 = encryptedColumnTransformer.to(encrypted1) as string;
      expect(encrypted2).toBe(encrypted1); // Should be unchanged

      // Decryption should still work
      const decrypted = encryptedColumnTransformer.from(encrypted2);
      expect(decrypted).toBe(plaintext);
    });

    it('should handle migration scenario (plaintext in database)', () => {
      const plaintextFromDb = 'old-plaintext-value';

      // Loading from DB should return plaintext as-is (migration support)
      const loaded = encryptedColumnTransformer.from(plaintextFromDb);
      expect(loaded).toBe(plaintextFromDb);

      // Saving should encrypt it
      const saved = encryptedColumnTransformer.to(plaintextFromDb) as string;
      expect(isEncrypted(saved)).toBe(true);

      // Loading encrypted value should decrypt it
      const reloaded = encryptedColumnTransformer.from(saved);
      expect(reloaded).toBe(plaintextFromDb);
    });

    it('should throw when encryption fails', () => {
      delete process.env.ENCRYPTION_KEY;

      expect(() => encryptedColumnTransformer.to('test')).toThrow(
        'Failed to encrypt column value'
      );
    });

    it('should not throw when decryption fails (lenient mode)', () => {
      // Create fake encrypted data that will fail decryption
      const fakeEncrypted = 'a'.repeat(24) + ':' + 'b'.repeat(32) + ':' + 'c'.repeat(16);

      // Should not throw - returns original value with warning
      const result = encryptedColumnTransformer.from(fakeEncrypted);
      expect(result).toBe(fakeEncrypted);
    });
  });

  describe('createEncryptedColumnTransformer with options', () => {
    it('should create transformer with allowNull=false', () => {
      const transformer = createEncryptedColumnTransformer({
        allowNull: false,
      });

      expect(transformer.to(null)).toBe(null);
      expect(transformer.to(undefined)).toBe(null);
    });

    it('should create transformer with allowEmpty=false', () => {
      const transformer = createEncryptedColumnTransformer({
        allowEmpty: false,
      });

      expect(transformer.to('')).toBe(null);
    });

    it('should create transformer with logWarnings=false', () => {
      const transformer = createEncryptedColumnTransformer({
        logWarnings: false,
      });

      delete process.env.ENCRYPTION_KEY;

      // Should still throw but not log
      expect(() => transformer.to('test')).toThrow();
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('should log warnings in development by default', () => {
      process.env.NODE_ENV = 'development';

      const transformer = createEncryptedColumnTransformer();

      delete process.env.ENCRYPTION_KEY;

      try {
        transformer.to('test');
      } catch {
        // Expected to throw
      }

      expect(errorSpy).toHaveBeenCalled();
    });

    it('should not log warnings in production by default', () => {
      process.env.NODE_ENV = 'production';

      const transformer = createEncryptedColumnTransformer();

      delete process.env.ENCRYPTION_KEY;

      try {
        transformer.to('test');
      } catch {
        // Expected to throw
      }

      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('should handle special characters', () => {
      const transformer = createEncryptedColumnTransformer();
      const specialChars = '!@#$%^&*()_+-=[]{}|;:,.<>?';

      const encrypted = transformer.to(specialChars) as string;
      const decrypted = transformer.from(encrypted);

      expect(decrypted).toBe(specialChars);
    });

    it('should handle unicode characters', () => {
      const transformer = createEncryptedColumnTransformer();
      const unicode = '你好世界 🔐 Здравствуй мир';

      const encrypted = transformer.to(unicode) as string;
      const decrypted = transformer.from(encrypted);

      expect(decrypted).toBe(unicode);
    });

    it('should handle long credentials', () => {
      const transformer = createEncryptedColumnTransformer();
      const longCredential = 'Bearer ' + 'x'.repeat(1000);

      const encrypted = transformer.to(longCredential) as string;
      const decrypted = transformer.from(encrypted);

      expect(decrypted).toBe(longCredential);
    });
  });

  describe('strictEncryptedColumnTransformer', () => {
    it('should encrypt plaintext values', () => {
      const plaintext = 'strict-secret';
      const encrypted = strictEncryptedColumnTransformer.to(
        plaintext
      ) as string;

      expect(isEncrypted(encrypted)).toBe(true);
    });

    it('should decrypt encrypted values', () => {
      const plaintext = 'strict-secret';
      const encrypted = encrypt(plaintext);

      const decrypted = strictEncryptedColumnTransformer.from(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle null/undefined/empty in to()', () => {
      expect(strictEncryptedColumnTransformer.to(null)).toBe(null);
      expect(strictEncryptedColumnTransformer.to(undefined)).toBe(undefined);
      expect(strictEncryptedColumnTransformer.to('')).toBe('');
    });

    it('should handle null/undefined/empty in from()', () => {
      expect(strictEncryptedColumnTransformer.from(null)).toBe(null);
      expect(strictEncryptedColumnTransformer.from(undefined)).toBe(undefined);
      expect(strictEncryptedColumnTransformer.from('')).toBe('');
    });

    it('should prevent double encryption', () => {
      const plaintext = 'test';

      const encrypted1 = strictEncryptedColumnTransformer.to(
        plaintext
      ) as string;
      const encrypted2 = strictEncryptedColumnTransformer.to(
        encrypted1
      ) as string;

      expect(encrypted2).toBe(encrypted1);
    });

    it('should throw when loading plaintext (strict mode)', () => {
      const plaintext = 'unencrypted-value';

      expect(() => strictEncryptedColumnTransformer.from(plaintext)).toThrow(
        'Value in database is not encrypted'
      );
    });

    it('should throw on decryption failure', () => {
      const fakeEncrypted = 'a'.repeat(24) + ':' + 'b'.repeat(32) + ':' + 'c'.repeat(16);

      expect(() =>
        strictEncryptedColumnTransformer.from(fakeEncrypted)
      ).toThrow();
    });

    it('should throw when encryption fails', () => {
      delete process.env.ENCRYPTION_KEY;

      expect(() => strictEncryptedColumnTransformer.to('test')).toThrow();
    });
  });

  describe('TypeORM integration scenarios', () => {
    it('should work with typical entity save flow', () => {
      const transformer = encryptedColumnTransformer;

      // User sets plaintext API key
      const apiKey = 'sk-prod-abc123xyz';

      // TypeORM calls to() before saving
      const valueToSave = transformer.to(apiKey);

      // Should be encrypted in database
      expect(isEncrypted(valueToSave as string)).toBe(true);

      // TypeORM calls from() when loading
      const loadedValue = transformer.from(valueToSave);

      // Should get plaintext back
      expect(loadedValue).toBe(apiKey);
    });

    it('should work with entity update flow', () => {
      const transformer = encryptedColumnTransformer;

      // Initial save
      const originalKey = 'key-v1';
      const saved1 = transformer.to(originalKey) as string;

      // Load from DB
      const loaded1 = transformer.from(saved1);
      expect(loaded1).toBe(originalKey);

      // Update to new key
      const newKey = 'key-v2';
      const saved2 = transformer.to(newKey) as string;

      // Load new key
      const loaded2 = transformer.from(saved2);
      expect(loaded2).toBe(newKey);
    });

    it('should handle batch operations', () => {
      const transformer = encryptedColumnTransformer;

      const credentials = [
        'api-key-1',
        'api-key-2',
        'api-key-3',
        null,
        undefined,
        '',
      ];

      // Save batch
      const encrypted = credentials.map((cred) => transformer.to(cred));

      // Load batch
      const decrypted = encrypted.map((enc) => transformer.from(enc));

      // Should match original
      expect(decrypted[0]).toBe(credentials[0]);
      expect(decrypted[1]).toBe(credentials[1]);
      expect(decrypted[2]).toBe(credentials[2]);
      expect(decrypted[3]).toBe(null);
      expect(decrypted[4]).toBe(undefined);
      expect(decrypted[5]).toBe('');
    });

    it('should handle migration from plaintext to encrypted', () => {
      const transformer = encryptedColumnTransformer;

      // Existing plaintext data in DB
      const plaintextValue = 'old-plaintext-api-key';

      // First load (migration period) - plaintext passes through
      const firstLoad = transformer.from(plaintextValue);
      expect(firstLoad).toBe(plaintextValue);

      // User updates entity - gets encrypted on save
      const afterSave = transformer.to(firstLoad) as string;
      expect(isEncrypted(afterSave)).toBe(true);

      // Subsequent loads decrypt properly
      const secondLoad = transformer.from(afterSave);
      expect(secondLoad).toBe(plaintextValue);
    });

    it('should handle partial updates', () => {
      const transformer = encryptedColumnTransformer;

      // Entity has encrypted credential
      const encrypted = transformer.to('my-credential') as string;

      // Load it
      const loaded = transformer.from(encrypted);

      // Save without changing it (should pass through already encrypted)
      const resaved = transformer.to(loaded) as string;

      // Should still be able to decrypt
      const reloaded = transformer.from(resaved);
      expect(reloaded).toBe('my-credential');
    });
  });

  describe('Security scenarios', () => {
    it('should detect tampering attempts', () => {
      const transformer = encryptedColumnTransformer;
      const plaintext = 'secret';

      // Encrypt normally
      const encrypted = transformer.to(plaintext) as string;

      // Tamper with encrypted data
      const parts = encrypted.split(':');
      const tampered = `${parts[0]}:${parts[1]}:${'f'.repeat(parts[2].length)}`;

      // Decryption should fail (returns tampered value with warning in lenient mode)
      const result = transformer.from(tampered);
      expect(result).toBe(tampered); // Falls back to original value
    });

    it('should require encryption key for saving', () => {
      const transformer = encryptedColumnTransformer;

      delete process.env.ENCRYPTION_KEY;

      // Should throw when trying to save without key
      expect(() => transformer.to('secret')).toThrow(
        'Failed to encrypt column value'
      );
      expect(() => transformer.to('secret')).toThrow('ENCRYPTION_KEY');
    });

    it('should prevent storing plaintext when encryption intended', () => {
      const transformer = encryptedColumnTransformer;

      delete process.env.ENCRYPTION_KEY;

      // Should throw rather than saving plaintext
      expect(() => transformer.to('secret')).toThrow();

      // Never should return plaintext when encryption was intended
      let savedValue: string | null | undefined;
      try {
        savedValue = transformer.to('secret');
      } catch {
        savedValue = undefined;
      }

      expect(savedValue).toBeUndefined();
    });

    it('should use different IVs for same plaintext', () => {
      const transformer = encryptedColumnTransformer;
      const plaintext = 'same-secret';

      const encrypted1 = transformer.to(plaintext) as string;
      const encrypted2 = transformer.to(plaintext) as string;

      // Should be different (random IV)
      expect(encrypted1).not.toBe(encrypted2);

      // But both should decrypt to same plaintext
      expect(transformer.from(encrypted1)).toBe(plaintext);
      expect(transformer.from(encrypted2)).toBe(plaintext);
    });
  });

  describe('Error handling edge cases', () => {
    it('should handle malformed encrypted data gracefully', () => {
      const transformer = encryptedColumnTransformer;

      const malformed = [
        'not:encrypted:properly:too:many',
        'just-one-part',
        '::', // Empty parts
        'short:tag:data',
        'ZZZZ:YYYY:XXXX', // Non-hex
      ];

      malformed.forEach((bad) => {
        // Should not throw, returns original value
        const result = transformer.from(bad);
        expect(result).toBe(bad);
      });
    });

    it('should handle null key buffer gracefully', () => {
      const transformer = encryptedColumnTransformer;

      process.env.ENCRYPTION_KEY = '';

      expect(() => transformer.to('test')).toThrow();
    });
  });
});
