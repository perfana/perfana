import { HasValidJsonDepthConstraint } from './json-depth.validator';

describe('HasValidJsonDepthConstraint', () => {
  let validator: HasValidJsonDepthConstraint;

  beforeEach(() => {
    validator = new HasValidJsonDepthConstraint();
  });

  describe('valid JSON depths', () => {
    it('should accept flat object', () => {
      const obj = { a: 1, b: 2, c: 3 };
      expect(validator.validate(obj)).toBe(true);
    });

    it('should accept nested object within limit (5 levels)', () => {
      const obj = {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: 'value'
              }
            }
          }
        }
      };
      expect(validator.validate(obj)).toBe(true);
    });

    it('should accept nested object at exactly 10 levels', () => {
      const obj = {
        l1: { l2: { l3: { l4: { l5: { l6: { l7: { l8: { l9: { l10: 'value' } } } } } } } } }
      };
      expect(validator.validate(obj)).toBe(true);
    });

    it('should accept arrays within object', () => {
      const obj = {
        config: {
          items: [
            { name: 'item1', value: 1 },
            { name: 'item2', value: 2 }
          ]
        }
      };
      expect(validator.validate(obj)).toBe(true);
    });

    it('should accept empty object', () => {
      expect(validator.validate({})).toBe(true);
    });
  });

  describe('invalid JSON depths', () => {
    it('should reject object exceeding 10 levels', () => {
      const obj = {
        l1: { l2: { l3: { l4: { l5: { l6: { l7: { l8: { l9: { l10: { l11: 'too deep' } } } } } } } } } }
      };
      expect(validator.validate(obj)).toBe(false);
    });

    it('should reject deeply nested arrays and objects', () => {
      const obj = {
        a: { b: { c: { d: { e: { f: { g: { h: { i: { j: { k: 'fail' } } } } } } } } } }
      };
      expect(validator.validate(obj)).toBe(false);
    });

    it('should reject non-object values', () => {
      expect(validator.validate('string')).toBe(false);
      expect(validator.validate(123)).toBe(false);
      expect(validator.validate(null)).toBe(false);
      expect(validator.validate(undefined)).toBe(false);
      expect(validator.validate([])).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle circular references gracefully', () => {
      const obj: any = { a: 1 };
      obj.self = obj; // Circular reference

      // Should not cause infinite loop
      // Will return false due to exceeding depth or true if handled correctly
      expect(() => validator.validate(obj)).not.toThrow();
    });

    it('should handle objects with null values', () => {
      const obj = {
        config: {
          value: null,
          nested: {
            also: null
          }
        }
      };
      expect(validator.validate(obj)).toBe(true);
    });
  });
});
