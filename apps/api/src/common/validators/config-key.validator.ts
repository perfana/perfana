import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  
} from 'class-validator';

/**
 * Validates configuration key format
 * - Must be alphanumeric with allowed special characters: - _ .
 * - Length: 1-255 characters
 * - No path traversal or injection attempts
 */
@ValidatorConstraint({ name: 'isValidConfigKey', async: false })
export class IsValidConfigKeyConstraint implements ValidatorConstraintInterface {
  validate(configKey: unknown): boolean {
    if (typeof configKey !== 'string') {
      return false;
    }

    // Length validation
    if (configKey.length === 0 || configKey.length > 255) {
      return false;
    }

    // Path traversal check
    if (configKey.includes('..') || configKey.includes('/') || configKey.includes('\\')) {
      return false;
    }

    // No HTML/script tags
    if (configKey.includes('<') || configKey.includes('>')) {
      return false;
    }

    // Format validation: alphanumeric + hyphen, underscore, dot
    const validFormat = /^[a-zA-Z0-9._-]+$/;
    return validFormat.test(configKey);
  }

  defaultMessage(): string {
    return 'Configuration key must contain only alphanumeric characters, hyphens, underscores, and dots (max 255 characters)';
  }
}

/** @public */
export function IsValidConfigKey(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsValidConfigKeyConstraint,
    });
  };
}
