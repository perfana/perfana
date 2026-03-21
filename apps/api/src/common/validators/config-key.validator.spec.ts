import { IsValidConfigKeyConstraint } from './config-key.validator';

describe('IsValidConfigKeyConstraint', () => {
  let validator: IsValidConfigKeyConstraint;

  beforeEach(() => {
    validator = new IsValidConfigKeyConstraint();
  });

  describe('valid configuration keys', () => {
    it('should accept alphanumeric with dots', () => {
      expect(validator.validate('jvm.heap.size')).toBe(true);
    });

    it('should accept alphanumeric with hyphens', () => {
      expect(validator.validate('database-pool-size')).toBe(true);
    });

    it('should accept alphanumeric with underscores', () => {
      expect(validator.validate('database_pool_size')).toBe(true);
    });

    it('should accept nested configuration keys', () => {
      expect(validator.validate('app.server.http.port')).toBe(true);
    });

    it('should accept single character', () => {
      expect(validator.validate('x')).toBe(true);
    });
  });

  describe('invalid configuration keys', () => {
    it('should reject empty string', () => {
      expect(validator.validate('')).toBe(false);
    });

    it('should reject non-string value', () => {
      expect(validator.validate(123)).toBe(false);
      expect(validator.validate(null)).toBe(false);
      expect(validator.validate(undefined)).toBe(false);
    });

    it('should reject string exceeding 255 characters', () => {
      const longKey = 'a'.repeat(256);
      expect(validator.validate(longKey)).toBe(false);
    });

    it('should reject path traversal', () => {
      expect(validator.validate('../config')).toBe(false);
      expect(validator.validate('config/../../etc')).toBe(false);
    });

    it('should reject HTML tags', () => {
      expect(validator.validate('<script>alert(1)</script>')).toBe(false);
      expect(validator.validate('config<tag>')).toBe(false);
      expect(validator.validate('config>tag')).toBe(false);
    });

    it('should reject special characters', () => {
      expect(validator.validate('config@value')).toBe(false);
      expect(validator.validate('config#value')).toBe(false);
      expect(validator.validate('config$value')).toBe(false);
      expect(validator.validate('config%value')).toBe(false);
    });

    it('should reject spaces', () => {
      expect(validator.validate('config key')).toBe(false);
    });
  });
});
