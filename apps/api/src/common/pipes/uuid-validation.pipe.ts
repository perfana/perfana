import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';
import { validate as isUUID } from 'uuid';

/**
 * Validates UUID parameters to prevent injection attacks
 * Accepts both UUID v4 format and test_run_id format (alphanumeric with allowed chars)
 */
@Injectable()
export class UuidValidationPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!value) {
      throw new BadRequestException('ID parameter is required');
    }

    // Trim whitespace
    const trimmedValue = value.trim();

    if (trimmedValue.length === 0) {
      throw new BadRequestException('ID parameter cannot be empty');
    }

    // Check if it's a UUID format
    if (isUUID(trimmedValue)) {
      return trimmedValue;
    }

    // Check if it's a valid test_run_id format (alphanumeric with dots, hyphens, underscores)
    const testRunIdFormat = /^[a-zA-Z0-9._-]+$/;
    if (trimmedValue.length <= 255 && testRunIdFormat.test(trimmedValue)) {
      // Additional security checks
      if (trimmedValue.includes('..') || trimmedValue.includes('/') || trimmedValue.includes('\\')) {
        throw new BadRequestException('ID contains invalid path traversal characters');
      }

      // SQL injection basic check
      const sqlKeywords = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'DROP', 'UNION', 'EXEC', '--', ';'];
      const upperValue = trimmedValue.toUpperCase();
      for (const keyword of sqlKeywords) {
        if (upperValue.includes(keyword)) {
          throw new BadRequestException('ID contains potentially malicious content');
        }
      }

      return trimmedValue;
    }

    throw new BadRequestException('Invalid ID format. Must be a UUID or valid test run identifier');
  }
}
