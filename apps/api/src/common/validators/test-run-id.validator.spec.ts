import { IsValidTestRunIdConstraint } from './test-run-id.validator';

describe('IsValidTestRunIdConstraint', () => {
  let validator: IsValidTestRunIdConstraint;

  beforeEach(() => {
    validator = new IsValidTestRunIdConstraint();
  });

  describe('valid test run IDs', () => {
    it('should accept alphanumeric with hyphens', () => {
      expect(validator.validate('test-run-123')).toBe(true);
    });

    it('should accept alphanumeric with underscores', () => {
      expect(validator.validate('test_run_123')).toBe(true);
    });

    it('should accept alphanumeric with dots', () => {
      expect(validator.validate('test.run.123')).toBe(true);
    });

    it('should accept mixed special characters', () => {
      expect(validator.validate('PaymentService-production-loadTest-20240115')).toBe(true);
    });

    it('should accept single character', () => {
      expect(validator.validate('A')).toBe(true);
    });

    it('should accept 255 character string', () => {
      const longId = 'a'.repeat(255);
      expect(validator.validate(longId)).toBe(true);
    });
  });

  describe('invalid test run IDs', () => {
    it('should reject empty string', () => {
      expect(validator.validate('')).toBe(false);
    });

    it('should reject non-string value', () => {
      expect(validator.validate(123)).toBe(false);
      expect(validator.validate(null)).toBe(false);
      expect(validator.validate(undefined)).toBe(false);
    });

    it('should reject string exceeding 255 characters', () => {
      const longId = 'a'.repeat(256);
      expect(validator.validate(longId)).toBe(false);
    });

    it('should reject path traversal with double dots', () => {
      expect(validator.validate('../etc/passwd')).toBe(false);
      expect(validator.validate('test..run')).toBe(false);
    });

    it('should reject forward slash', () => {
      expect(validator.validate('test/run')).toBe(false);
    });

    it('should reject backslash', () => {
      expect(validator.validate('test\\run')).toBe(false);
    });

    it('should reject SQL injection attempts', () => {
      expect(validator.validate('test; DROP TABLE users--')).toBe(false);
      expect(validator.validate('SELECT * FROM test_runs')).toBe(false);
      expect(validator.validate('test UNION SELECT')).toBe(false);
      expect(validator.validate('test INSERT INTO')).toBe(false);
      expect(validator.validate('test UPDATE SET')).toBe(false);
      expect(validator.validate('test DELETE FROM')).toBe(false);
    });

    it('should reject special characters', () => {
      expect(validator.validate('test@run')).toBe(false);
      expect(validator.validate('test#run')).toBe(false);
      expect(validator.validate('test$run')).toBe(false);
      expect(validator.validate('test%run')).toBe(false);
      expect(validator.validate('test&run')).toBe(false);
      expect(validator.validate('test*run')).toBe(false);
    });

    it('should reject spaces', () => {
      expect(validator.validate('test run')).toBe(false);
    });

    it('should reject HTML/script tags', () => {
      expect(validator.validate('<script>alert(1)</script>')).toBe(false);
      expect(validator.validate('test<b>run</b>')).toBe(false);
    });
  });
});
