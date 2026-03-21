import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  
} from 'class-validator';

/**
 * Validates test run ID format
 * - Must be alphanumeric with allowed special characters: - _ .
 * - Length: 1-255 characters
 * - No path traversal attempts (.., /, \)
 * - No SQL injection attempts
 */
@ValidatorConstraint({ name: 'isValidTestRunId', async: false })
export class IsValidTestRunIdConstraint implements ValidatorConstraintInterface {
  validate(testRunId: any): boolean {
    if (typeof testRunId !== 'string') {
      return false;
    }

    // Length validation
    if (testRunId.length === 0 || testRunId.length > 255) {
      return false;
    }

    // Path traversal check
    if (testRunId.includes('..') || testRunId.includes('/') || testRunId.includes('\\')) {
      return false;
    }

    // SQL injection basic check
    const sqlKeywords = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'DROP', 'UNION', 'EXEC', '--', ';'];
    const upperTestRunId = testRunId.toUpperCase();
    for (const keyword of sqlKeywords) {
      if (upperTestRunId.includes(keyword)) {
        return false;
      }
    }

    // Format validation: alphanumeric + hyphen, underscore, dot
    const validFormat = /^[a-zA-Z0-9._-]+$/;
    return validFormat.test(testRunId);
  }

  defaultMessage(): string {
    return 'Test run ID must contain only alphanumeric characters, hyphens, underscores, and dots (max 255 characters)';
  }
}

export function IsValidTestRunId(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsValidTestRunIdConstraint,
    });
  };
}
