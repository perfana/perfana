import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  
} from 'class-validator';

/**
 * Validates JSON object depth to prevent deeply nested objects
 * that can cause stack overflow or performance issues
 */
@ValidatorConstraint({ name: 'hasValidJsonDepth', async: false })
export class HasValidJsonDepthConstraint implements ValidatorConstraintInterface {
  private readonly maxDepth = 10;

  private getDepth(obj: any, currentDepth: number = 0): number {
    if (currentDepth > this.maxDepth) {
      return currentDepth;
    }

    if (obj === null || typeof obj !== 'object') {
      return currentDepth;
    }

    let maxChildDepth = currentDepth;

    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const childDepth = this.getDepth(obj[key], currentDepth + 1);
        maxChildDepth = Math.max(maxChildDepth, childDepth);
      }
    }

    return maxChildDepth;
  }

  validate(json: any): boolean {
    if (json === null || typeof json !== 'object' || Array.isArray(json)) {
      return false;
    }

    const depth = this.getDepth(json);
    return depth <= this.maxDepth;
  }

  defaultMessage(): string {
    return `JSON object depth must not exceed ${this.maxDepth} levels`;
  }
}

export function HasValidJsonDepth(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: HasValidJsonDepthConstraint,
    });
  };
}
