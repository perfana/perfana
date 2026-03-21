/**
 * Unit tests for Safe Regex Utilities (ReDoS Prevention)
 *
 * Tests cover:
 * - Dangerous pattern detection (nested quantifiers, wildcards, etc.)
 * - Pattern validation (length, syntax, safety)
 * - Safe regex creation and execution
 * - Input length limits for matching
 * - Edge cases and error handling
 */

import {
  validateRegexPattern,
  isSafeRegexPattern,
  createSafeRegex,
  safeRegexTest,
  safeRegexMatch,
} from '../safe-regex';

describe('Safe Regex Utilities', () => {
  describe('validateRegexPattern', () => {
    describe('valid patterns', () => {
      it('should validate simple patterns', () => {
        const result = validateRegexPattern('^[a-z]+$');

        expect(result.safe).toBe(true);
        expect(result.regex).toBeInstanceOf(RegExp);
        expect(result.error).toBeUndefined();
      });

      it('should validate patterns with character classes', () => {
        const patterns = [
          '[0-9]+',
          '[a-zA-Z]+',
          '[^abc]',
          '\\d+',
          '\\w+',
          '\\s+',
        ];

        patterns.forEach((pattern) => {
          const result = validateRegexPattern(pattern);
          expect(result.safe).toBe(true);
          expect(result.regex).toBeInstanceOf(RegExp);
        });
      });

      it('should validate patterns with quantifiers', () => {
        const patterns = ['a+', 'b*', 'c?', 'd{2}', 'e{2,5}', 'f{2,}'];

        patterns.forEach((pattern) => {
          const result = validateRegexPattern(pattern);
          expect(result.safe).toBe(true);
        });
      });

      it('should validate patterns with anchors', () => {
        const patterns = ['^start', 'end$', '^exact$', '\\bword\\b'];

        patterns.forEach((pattern) => {
          const result = validateRegexPattern(pattern);
          expect(result.safe).toBe(true);
        });
      });

      it('should validate patterns with alternation', () => {
        const result = validateRegexPattern('foo|bar|baz');

        expect(result.safe).toBe(true);
      });

      it('should validate patterns with groups', () => {
        const patterns = ['(abc)', '(?:xyz)', '(foo)bar', '(a)(b)(c)'];

        patterns.forEach((pattern) => {
          const result = validateRegexPattern(pattern);
          expect(result.safe).toBe(true);
        });
      });

      it('should validate patterns with lookaheads', () => {
        const patterns = ['foo(?=bar)', 'foo(?!bar)'];

        patterns.forEach((pattern) => {
          const result = validateRegexPattern(pattern);
          expect(result.safe).toBe(true);
        });
      });

      it('should accept flags in options', () => {
        const result = validateRegexPattern('^test$', { flags: 'i' });

        expect(result.safe).toBe(true);
        expect(result.regex!.flags).toContain('i');
        expect(result.regex!.test('TEST')).toBe(true);
      });
    });

    describe('dangerous patterns (ReDoS)', () => {
      it('should detect nested quantifiers (a+)+', () => {
        const dangerousPatterns = [
          '(a+)+',
          '(a*)+',
          '(a{2,})+',
          '(b+)*',
          '(c*)*',
        ];

        dangerousPatterns.forEach((pattern) => {
          const result = validateRegexPattern(pattern);
          expect(result.safe).toBe(false);
          expect(result.error).toContain('ReDoS');
        });
      });

      it('should detect multiple consecutive wildcards', () => {
        const dangerousPatterns = ['.*.*', '.*?.*', '.*.*?', '.*?.*?'];

        dangerousPatterns.forEach((pattern) => {
          const result = validateRegexPattern(pattern);
          expect(result.safe).toBe(false);
          expect(result.error).toContain('ReDoS');
        });
      });

      it('should detect excessive backtracking patterns', () => {
        const dangerousPatterns = ['(.+)+(.+)+', '(.*)+(.*)+'];

        dangerousPatterns.forEach((pattern) => {
          const result = validateRegexPattern(pattern);
          expect(result.safe).toBe(false);
          expect(result.error).toContain('ReDoS');
        });
      });

      it('should detect large repetition ranges', () => {
        const dangerousPatterns = [
          'a{10000}',
          'b{99999}',
          'c{1000,}',
          'd{5000,10000}',
        ];

        dangerousPatterns.forEach((pattern) => {
          const result = validateRegexPattern(pattern);
          expect(result.safe).toBe(false);
          expect(result.error).toContain('ReDoS');
        });
      });

      it('should detect overlapping alternation with quantifiers', () => {
        const dangerousPatterns = ['(a|ab)+', '(foo|foobar)*', '(x|xy)+'];

        dangerousPatterns.forEach((pattern) => {
          const result = validateRegexPattern(pattern);
          expect(result.safe).toBe(false);
          expect(result.error).toContain('ReDoS');
        });
      });
    });

    describe('invalid patterns', () => {
      it('should reject non-string patterns', () => {
        const invalidInputs = [123, {}, [], null, undefined, true];

        invalidInputs.forEach((input) => {
          const result = validateRegexPattern(input as any);
          expect(result.safe).toBe(false);
          expect(result.error).toContain('must be a string');
        });
      });

      it('should reject empty patterns', () => {
        const result = validateRegexPattern('');

        expect(result.safe).toBe(false);
        expect(result.error).toContain('cannot be empty');
      });

      it('should reject patterns exceeding max length', () => {
        const longPattern = 'a'.repeat(1000);
        const result = validateRegexPattern(longPattern);

        expect(result.safe).toBe(false);
        expect(result.error).toContain('maximum length');
      });

      it('should respect custom max length', () => {
        const pattern = 'a'.repeat(100);
        const result = validateRegexPattern(pattern, { maxLength: 50 });

        expect(result.safe).toBe(false);
        expect(result.error).toContain('maximum length');
      });

      it('should reject invalid regex syntax', () => {
        const invalidPatterns = [
          '[',
          '(',
          '(?',
          '*',
          '+',
          '?',
          // Note: '{' is valid in JavaScript regex (treated as literal character)
          '(?<)',
          '[z-a]',
        ];

        invalidPatterns.forEach((pattern) => {
          const result = validateRegexPattern(pattern);
          expect(result.safe).toBe(false);
          expect(result.error).toContain('Invalid regex syntax');
        });
      });
    });

    describe('edge cases', () => {
      it('should handle patterns with escaped characters', () => {
        const patterns = [
          '\\.',
          '\\*',
          '\\+',
          '\\?',
          '\\[',
          '\\]',
          '\\{',
          '\\}',
          '\\(',
          '\\)',
        ];

        patterns.forEach((pattern) => {
          const result = validateRegexPattern(pattern);
          expect(result.safe).toBe(true);
        });
      });

      it('should handle patterns with unicode', () => {
        const result = validateRegexPattern('[\\u4e00-\\u9fa5]+');

        expect(result.safe).toBe(true);
        expect(result.regex!.test('你好')).toBe(true);
      });

      it('should handle complex but safe patterns', () => {
        const safeComplexPatterns = [
          '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$', // Email
          '^\\d{3}-\\d{2}-\\d{4}$', // SSN format
          '^https?://[\\w.-]+\\.[a-z]{2,}(/.*)?$', // URL
        ];

        safeComplexPatterns.forEach((pattern) => {
          const result = validateRegexPattern(pattern);
          expect(result.safe).toBe(true);
        });
      });

      it('should handle whitespace in patterns', () => {
        const result = validateRegexPattern('foo\\s+bar');

        expect(result.safe).toBe(true);
        expect(result.regex!.test('foo  bar')).toBe(true);
      });
    });
  });

  describe('isSafeRegexPattern', () => {
    it('should return true for safe patterns', () => {
      expect(isSafeRegexPattern('^[a-z]+$')).toBe(true);
      expect(isSafeRegexPattern('[0-9]+')).toBe(true);
      expect(isSafeRegexPattern('foo|bar')).toBe(true);
    });

    it('should return false for dangerous patterns', () => {
      expect(isSafeRegexPattern('(a+)+')).toBe(false);
      expect(isSafeRegexPattern('.*.*')).toBe(false);
      expect(isSafeRegexPattern('a{10000}')).toBe(false);
    });

    it('should return false for invalid patterns', () => {
      expect(isSafeRegexPattern('')).toBe(false);
      expect(isSafeRegexPattern(null as any)).toBe(false);
      expect(isSafeRegexPattern('[')).toBe(false);
    });

    it('should accept options', () => {
      const longPattern = 'a'.repeat(100);

      expect(isSafeRegexPattern(longPattern, { maxLength: 200 })).toBe(true);
      expect(isSafeRegexPattern(longPattern, { maxLength: 50 })).toBe(false);
    });
  });

  describe('createSafeRegex', () => {
    it('should create RegExp for safe patterns', () => {
      const regex = createSafeRegex('^test$');

      expect(regex).toBeInstanceOf(RegExp);
      expect(regex.test('test')).toBe(true);
      expect(regex.test('other')).toBe(false);
    });

    it('should throw for dangerous patterns', () => {
      expect(() => createSafeRegex('(a+)+')).toThrow('ReDoS');
    });

    it('should throw for invalid patterns', () => {
      expect(() => createSafeRegex('[')).toThrow('Invalid regex syntax');
      expect(() => createSafeRegex('')).toThrow('cannot be empty');
    });

    it('should accept flags', () => {
      const regex = createSafeRegex('^test$', { flags: 'i' });

      expect(regex.test('TEST')).toBe(true);
      expect(regex.test('TeSt')).toBe(true);
    });

    it('should create working regex for complex patterns', () => {
      const emailRegex = createSafeRegex(
        '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$'
      );

      expect(emailRegex.test('user@example.com')).toBe(true);
      expect(emailRegex.test('invalid-email')).toBe(false);
    });

    it('should enforce max length option', () => {
      const pattern = 'a'.repeat(100);

      expect(() => createSafeRegex(pattern, { maxLength: 50 })).toThrow(
        'maximum length'
      );
    });
  });

  describe('safeRegexTest', () => {
    it('should execute regex test safely', () => {
      const regex = /^[a-z]+$/;

      expect(safeRegexTest(regex, 'abc')).toBe(true);
      expect(safeRegexTest(regex, 'ABC')).toBe(false);
    });

    it('should return null for non-string input', () => {
      const regex = /test/;

      expect(safeRegexTest(regex, 123 as any)).toBe(null);
      expect(safeRegexTest(regex, {} as any)).toBe(null);
      expect(safeRegexTest(regex, null as any)).toBe(null);
    });

    it('should return null for input exceeding max length', () => {
      const regex = /a+/;
      const longInput = 'a'.repeat(20000);

      const result = safeRegexTest(regex, longInput, 10000);

      expect(result).toBe(null);
    });

    it('should accept input within max length', () => {
      const regex = /a+/;
      const input = 'a'.repeat(5000);

      const result = safeRegexTest(regex, input, 10000);

      expect(result).toBe(true);
    });

    it('should use default max length of 10000', () => {
      const regex = /a+/;
      const longInput = 'a'.repeat(15000);

      const result = safeRegexTest(regex, longInput);

      expect(result).toBe(null);
    });

    it('should work with complex patterns', () => {
      const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

      expect(safeRegexTest(emailRegex, 'user@example.com')).toBe(true);
      expect(safeRegexTest(emailRegex, 'invalid')).toBe(false);
    });
  });

  describe('safeRegexMatch', () => {
    it('should execute regex match safely', () => {
      const regex = /([a-z]+)/;

      const match = safeRegexMatch(regex, 'hello');

      expect(match).not.toBeNull();
      expect(match![0]).toBe('hello');
      expect(match![1]).toBe('hello');
    });

    it('should return null for non-matches', () => {
      const regex = /\d+/;

      const match = safeRegexMatch(regex, 'abc');

      expect(match).toBeNull();
    });

    it('should return null for non-string input', () => {
      const regex = /test/;

      expect(safeRegexMatch(regex, 123 as any)).toBeNull();
      expect(safeRegexMatch(regex, {} as any)).toBeNull();
    });

    it('should return null for input exceeding max length', () => {
      const regex = /a+/;
      const longInput = 'a'.repeat(20000);

      const match = safeRegexMatch(regex, longInput, 10000);

      expect(match).toBeNull();
    });

    it('should accept input within max length', () => {
      const regex = /a+/;
      const input = 'a'.repeat(5000);

      const match = safeRegexMatch(regex, input, 10000);

      expect(match).not.toBeNull();
      expect(match![0]).toBe(input);
    });

    it('should capture groups correctly', () => {
      const regex = /^(\w+)@(\w+)\.(\w+)$/;

      const match = safeRegexMatch(regex, 'user@example.com');

      expect(match).not.toBeNull();
      expect(match![1]).toBe('user');
      expect(match![2]).toBe('example');
      expect(match![3]).toBe('com');
    });

    it('should work with global flag', () => {
      const regex = /\d+/g;
      const input = 'a1b2c3';

      // Note: match() with global flag returns all matches
      const match = safeRegexMatch(regex, input);

      expect(match).not.toBeNull();
      expect(match![0]).toBe('1');
    });
  });

  describe('ReDoS protection scenarios', () => {
    it('should prevent catastrophic backtracking with nested quantifiers', () => {
      const pattern = '(a+)+';

      expect(() => createSafeRegex(pattern)).toThrow('ReDoS');
    });

    it('should prevent catastrophic backtracking with alternation', () => {
      const pattern = '(a|ab)+';

      expect(() => createSafeRegex(pattern)).toThrow('ReDoS');
    });

    it('should allow safe quantifiers without nesting', () => {
      const patterns = ['a+', 'b*', 'c{2,5}', '(abc)+', '(xyz)*'];

      patterns.forEach((pattern) => {
        expect(() => createSafeRegex(pattern)).not.toThrow();
      });
    });

    it('should prevent DoS with input length limits', () => {
      const regex = /a*b/;
      const maliciousInput = 'a'.repeat(100000) + 'c'; // No 'b', causes backtracking

      // Without limits, this could hang
      // With limits, returns null
      const result = safeRegexTest(regex, maliciousInput, 10000);

      expect(result).toBe(null);
    });

    it('should handle valid long input within limits', () => {
      const regex = /^[a-z]+$/;
      const validInput = 'a'.repeat(5000);

      const result = safeRegexTest(regex, validInput, 10000);

      expect(result).toBe(true);
    });
  });

  describe('Real-world pattern examples', () => {
    it('should validate email regex', () => {
      const emailPattern = '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$';

      const result = validateRegexPattern(emailPattern);
      expect(result.safe).toBe(true);

      const regex = result.regex!;
      expect(regex.test('user@example.com')).toBe(true);
      expect(regex.test('invalid-email')).toBe(false);
    });

    it('should validate URL regex', () => {
      const urlPattern = '^https?://[\\w.-]+\\.[a-z]{2,}(/.*)?$';

      const result = validateRegexPattern(urlPattern);
      expect(result.safe).toBe(true);

      const regex = result.regex!;
      expect(regex.test('https://example.com')).toBe(true);
      expect(regex.test('http://example.com/path')).toBe(true);
    });

    it('should validate metric name pattern', () => {
      const metricPattern = '^[a-zA-Z][a-zA-Z0-9_]*$';

      const result = validateRegexPattern(metricPattern);
      expect(result.safe).toBe(true);

      const regex = result.regex!;
      expect(regex.test('cpu_usage')).toBe(true);
      expect(regex.test('99_invalid')).toBe(false);
    });

    it('should validate IP address pattern', () => {
      const ipPattern =
        '^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.' +
        '(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.' +
        '(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.' +
        '(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$';

      const result = validateRegexPattern(ipPattern);
      expect(result.safe).toBe(true);

      const regex = result.regex!;
      expect(regex.test('192.168.1.1')).toBe(true);
      expect(regex.test('256.1.1.1')).toBe(false);
    });

    it('should validate date pattern', () => {
      const datePattern = '^\\d{4}-\\d{2}-\\d{2}$';

      const result = validateRegexPattern(datePattern);
      expect(result.safe).toBe(true);

      const regex = result.regex!;
      expect(regex.test('2024-01-20')).toBe(true);
      expect(regex.test('2024/01/20')).toBe(false);
    });

    it('should reject known ReDoS pattern from CVEs', () => {
      // CVE-2018-3721 example (lodash vulnerability)
      const reDoSPattern = '(x+)+y';

      const result = validateRegexPattern(reDoSPattern);
      expect(result.safe).toBe(false);
      expect(result.error).toContain('ReDoS');
    });
  });
});
