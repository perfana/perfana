import { IsSafeRegexConstraint } from './safe-regex.validator';

describe('IsSafeRegexConstraint', () => {
  let validator: IsSafeRegexConstraint;

  beforeEach(() => {
    validator = new IsSafeRegexConstraint();
  });

  describe('valid regex patterns', () => {
    it('should accept simple patterns', () => {
      expect(validator.validate('test')).toBe(true);
      expect(validator.validate('^start')).toBe(true);
      expect(validator.validate('end$')).toBe(true);
    });

    it('should accept safe wildcards', () => {
      expect(validator.validate('test.*')).toBe(true);
      expect(validator.validate('jvm.+')).toBe(true);
    });

    it('should accept character classes', () => {
      expect(validator.validate('[a-z]+')).toBe(true);
      expect(validator.validate('[0-9]{1,3}')).toBe(true);
    });

    it('should accept alternation without quantifiers', () => {
      expect(validator.validate('(test|prod)')).toBe(true);
    });
  });

  describe('invalid regex patterns - ReDoS vectors', () => {
    it('should reject nested quantifiers', () => {
      expect(validator.validate('(a+)+')).toBe(false);
      expect(validator.validate('(a*)*')).toBe(false);
      expect(validator.validate('(a{2,5}){2,5}')).toBe(false);
    });

    it('should reject multiple consecutive wildcards', () => {
      expect(validator.validate('.*.*')).toBe(false);
    });

    it('should reject excessive backtracking patterns', () => {
      expect(validator.validate('(.*)+(.*)+ ')).toBe(false);
    });

    it('should reject large repetition ranges', () => {
      expect(validator.validate('a{10000}')).toBe(false);
    });

    it('should reject overlapping alternation with quantifiers', () => {
      expect(validator.validate('(a|ab)*')).toBe(false);
      expect(validator.validate('(test|testing)+')).toBe(false);
    });

    it('should reject patterns exceeding 500 characters', () => {
      const longPattern = 'a'.repeat(501);
      expect(validator.validate(longPattern)).toBe(false);
    });

    it('should reject invalid regex syntax', () => {
      expect(validator.validate('(unclosed')).toBe(false);
      expect(validator.validate('[unclosed')).toBe(false);
      expect(validator.validate('(?invalid)')).toBe(false);
    });

    it('should reject non-string values', () => {
      expect(validator.validate(123)).toBe(false);
      expect(validator.validate(null)).toBe(false);
      expect(validator.validate(undefined)).toBe(false);
    });
  });
});
