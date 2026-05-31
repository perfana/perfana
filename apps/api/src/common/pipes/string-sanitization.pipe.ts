import { PipeTransform, Injectable } from '@nestjs/common';

/**
 * Sanitizes string query parameters to prevent XSS and injection attacks
 * - Trims whitespace
 * - Limits length
 * - Removes dangerous characters
 */
@Injectable()
/** @public */
export class StringSanitizationPipe implements PipeTransform<string, string> {
  constructor(
    private readonly options?: {
      maxLength?: number;
      allowedPattern?: RegExp;
      required?: boolean;
    }
  ) {}

  transform(value: string): string {
    // Handle undefined/null for optional parameters
    if (value === undefined || value === null) {
      if (this.options?.required) {
        throw new Error('Required parameter is missing');
      }
      return value;
    }

    // Trim whitespace
    let sanitized = value.trim();

    // Length validation
    const maxLength = this.options?.maxLength || 255;
    if (sanitized.length > maxLength) {
      throw new Error(`Parameter exceeds maximum length of ${maxLength} characters`);
    }

    // Pattern validation if specified
    if (this.options?.allowedPattern && !this.options.allowedPattern.test(sanitized)) {
      throw new Error('Parameter contains invalid characters');
    }

    // Remove common XSS vectors
    sanitized = sanitized.replace(/<script[^>]*>.*?<\/script>/gi, '');
    sanitized = sanitized.replace(/<[^>]+>/g, '');

    // Check for SQL injection attempts
    const sqlPatterns = [/(\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bDROP\b|\bUNION\b|\bEXEC\b)/i, /--/, /;/];
    for (const pattern of sqlPatterns) {
      if (pattern.test(sanitized)) {
        throw new Error('Parameter contains potentially malicious content');
      }
    }

    // Check for path traversal
    if (sanitized.includes('..') || sanitized.includes('/') || sanitized.includes('\\')) {
      throw new Error('Parameter contains path traversal characters');
    }

    return sanitized;
  }
}
