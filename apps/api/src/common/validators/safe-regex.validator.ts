import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  
} from 'class-validator';

/**
 * Validates regex patterns to prevent ReDoS (Regular Expression Denial of Service)
 * Checks for dangerous patterns that can cause exponential backtracking
 */
@ValidatorConstraint({ name: 'isSafeRegex', async: false })
export class IsSafeRegexConstraint implements ValidatorConstraintInterface {
  private readonly dangerousPatterns = [
    // Nested quantifiers - group with quantifier followed by quantifier
    /\([^)]*[*+{][^)]*\)[*+{]/,
    // Multiple consecutive wildcards
    /\.\*\.\*/,
    // Excessive backtracking patterns
    /\(.*\)\+\(.*\)\+/,
    // Large repetition ranges
    /\{[0-9]{4,}\}/,
    // Overlapping alternation with quantifiers
    /\(.+\|.+\)[*+]/,
  ];

  validate(pattern: unknown): boolean {
    if (typeof pattern !== 'string') {
      return false;
    }

    // Length limit
    if (pattern.length > 500) {
      return false;
    }

    // Check for dangerous patterns
    for (const dangerousPattern of this.dangerousPatterns) {
      if (dangerousPattern.test(pattern)) {
        return false;
      }
    }

    // Try to compile the regex - will throw if invalid
    try {
      new RegExp(pattern);
    } catch (error) {
      return false;
    }

    return true;
  }

  defaultMessage(): string {
    return 'Regex pattern is invalid or potentially dangerous (ReDoS risk detected)';
  }
}

export function IsSafeRegex(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsSafeRegexConstraint,
    });
  };
}
