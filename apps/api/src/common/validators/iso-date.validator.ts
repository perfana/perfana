import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  
} from 'class-validator';

/**
 * Validates ISO 8601 date string format
 * Ensures date is valid and within reasonable range (1970-2100)
 */
@ValidatorConstraint({ name: 'isValidISODate', async: false })
export class IsValidISODateConstraint implements ValidatorConstraintInterface {
  validate(dateString: any): boolean {
    if (typeof dateString !== 'string') {
      return false;
    }

    // Basic ISO 8601 format check (strict - no timezone offsets)
    const isoDateRegex = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{3})?(Z)?$/;
    const match = isoDateRegex.exec(dateString);
    if (!match) {
      return false;
    }

    // Extract date components from the string
    const [, yearStr, monthStr, dayStr, hourStr, minuteStr, secondStr, , zSuffix] = match;
    const year = parseInt(yearStr!, 10);
    const month = parseInt(monthStr!, 10);
    const day = parseInt(dayStr!, 10);
    const hour = parseInt(hourStr!, 10);
    const minute = parseInt(minuteStr!, 10);
    const second = parseInt(secondStr!, 10);
    const hasZSuffix = zSuffix === 'Z';

    // Reasonable date range: 1970-2100 (inclusive)
    if (year < 1970 || year > 2100) {
      return false;
    }

    // Parse and validate date
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
      return false;
    }

    // Verify parsed date matches input components
    // (JavaScript auto-corrects invalid dates like Feb 30 -> Mar 2)
    // Use UTC methods if Z suffix present, otherwise use local methods
    const actualYear = hasZSuffix ? date.getUTCFullYear() : date.getFullYear();
    const actualMonth = (hasZSuffix ? date.getUTCMonth() : date.getMonth()) + 1;
    const actualDay = hasZSuffix ? date.getUTCDate() : date.getDate();
    const actualHour = hasZSuffix ? date.getUTCHours() : date.getHours();
    const actualMinute = hasZSuffix ? date.getUTCMinutes() : date.getMinutes();
    const actualSecond = hasZSuffix ? date.getUTCSeconds() : date.getSeconds();

    if (
      actualYear !== year ||
      actualMonth !== month ||
      actualDay !== day ||
      actualHour !== hour ||
      actualMinute !== minute ||
      actualSecond !== second
    ) {
      return false;
    }

    return true;
  }

  defaultMessage(): string {
    return 'Date must be a valid ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ) and within range 1970-2100';
  }
}

export function IsValidISODate(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsValidISODateConstraint,
    });
  };
}
