import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { validate as uuidValidate } from 'uuid';

/**
 * Synthetic Dashboard ID for Performance Test metrics
 * This constant UUID is used as a placeholder since performance test data
 * doesn't originate from actual Grafana dashboards.
 */
export const PERF_TEST_APP_DASHBOARD_ID = '00000000-0000-0000-0000-000000000001';

@ValidatorConstraint({ async: false })
export class IsUuidOrSyntheticConstraint implements ValidatorConstraintInterface {
  validate(value: any, _args: ValidationArguments) {
    if (typeof value !== 'string') {
      return false;
    }

    // Accept the synthetic dashboard ID
    if (value === PERF_TEST_APP_DASHBOARD_ID) {
      return true;
    }

    // Validate as a proper UUID
    return uuidValidate(value);
  }

  defaultMessage(args: ValidationArguments) {
    return `${args.property} must be a valid UUID or the synthetic dashboard ID`;
  }
}

/**
 * Custom decorator that validates UUID format or accepts the synthetic dashboard ID
 * used for Performance Test metrics.
 *
 * @param validationOptions - Standard class-validator validation options
 */
export function IsUuidOrSynthetic(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsUuidOrSyntheticConstraint,
    });
  };
}
