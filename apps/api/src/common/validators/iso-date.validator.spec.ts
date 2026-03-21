import { IsValidISODateConstraint } from './iso-date.validator';

describe('IsValidISODateConstraint', () => {
  let validator: IsValidISODateConstraint;

  beforeEach(() => {
    validator = new IsValidISODateConstraint();
  });

  describe('valid ISO dates', () => {
    it('should accept ISO 8601 with milliseconds and Z', () => {
      expect(validator.validate('2024-01-15T10:30:00.000Z')).toBe(true);
    });

    it('should accept ISO 8601 without milliseconds', () => {
      expect(validator.validate('2024-01-15T10:30:00Z')).toBe(true);
    });

    it('should accept ISO 8601 without Z', () => {
      expect(validator.validate('2024-01-15T10:30:00.000')).toBe(true);
    });

    it('should accept date at year boundaries', () => {
      expect(validator.validate('1970-01-01T00:00:00.000Z')).toBe(true);
      expect(validator.validate('2100-12-31T23:59:59.999Z')).toBe(true);
    });

    it('should accept leap year dates', () => {
      expect(validator.validate('2024-02-29T12:00:00.000Z')).toBe(true);
    });
  });

  describe('invalid ISO dates', () => {
    it('should reject non-string values', () => {
      expect(validator.validate(123)).toBe(false);
      expect(validator.validate(null)).toBe(false);
      expect(validator.validate(undefined)).toBe(false);
    });

    it('should reject invalid date formats', () => {
      expect(validator.validate('2024-01-15')).toBe(false);
      expect(validator.validate('01/15/2024')).toBe(false);
      expect(validator.validate('2024-1-15T10:30:00Z')).toBe(false);
    });

    it('should reject dates before 1970', () => {
      expect(validator.validate('1969-12-31T23:59:59.999Z')).toBe(false);
      expect(validator.validate('1900-01-01T00:00:00.000Z')).toBe(false);
    });

    it('should reject dates after 2100', () => {
      expect(validator.validate('2101-01-01T00:00:00.000Z')).toBe(false);
      expect(validator.validate('2200-01-01T00:00:00.000Z')).toBe(false);
    });

    it('should reject invalid dates', () => {
      expect(validator.validate('2024-02-30T10:30:00.000Z')).toBe(false);
      expect(validator.validate('2024-13-01T10:30:00.000Z')).toBe(false);
      expect(validator.validate('2024-01-32T10:30:00.000Z')).toBe(false);
    });

    it('should reject invalid times', () => {
      expect(validator.validate('2024-01-15T25:00:00.000Z')).toBe(false);
      expect(validator.validate('2024-01-15T10:60:00.000Z')).toBe(false);
      expect(validator.validate('2024-01-15T10:30:60.000Z')).toBe(false);
    });

    it('should reject malformed strings', () => {
      expect(validator.validate('not a date')).toBe(false);
      expect(validator.validate('')).toBe(false);
      expect(validator.validate('2024-01-15T10:30:00.000Z extra text')).toBe(false);
    });

    it('should reject dates with timezone offsets', () => {
      expect(validator.validate('2024-01-15T10:30:00+01:00')).toBe(false);
      expect(validator.validate('2024-01-15T10:30:00-05:00')).toBe(false);
    });
  });
});
