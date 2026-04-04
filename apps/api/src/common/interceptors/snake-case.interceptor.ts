import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Interceptor to transform response data from camelCase to snake_case
 *
 * This ensures API responses use snake_case field names to match:
 * - Database column naming convention
 * - Frontend type definitions
 * - Legacy API contract
 */
@Injectable()
export class SnakeCaseInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((data) => this.transformToSnakeCase(data)),
    );
  }

  private transformToSnakeCase(data: unknown): unknown {
    if (data === null || data === undefined) {
      return data;
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.transformToSnakeCase(item));
    }

    if (typeof data === 'object' && (data as object).constructor === Object) {
      const transformed: Record<string, unknown> = {};

      const obj = data as Record<string, unknown>;
      for (const key in obj) {
        if (Object.hasOwn(obj, key)) {
          const snakeKey = this.toSnakeCase(key);
          transformed[snakeKey] = this.transformToSnakeCase(obj[key]);
        }
      }

      return transformed;
    }

    return data;
  }

  private toSnakeCase(str: string): string {
    return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  }
}
