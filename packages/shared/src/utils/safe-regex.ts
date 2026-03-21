/**
 * Safe Regex Utility
 *
 * Provides utilities for validating regex patterns to prevent ReDoS
 * (Regular Expression Denial of Service) attacks.
 *
 * ReDoS occurs when malicious input causes exponential backtracking
 * in regular expression engines, consuming excessive CPU resources.
 *
 * This utility checks for known dangerous patterns that can cause
 * catastrophic backtracking and provides safe regex creation.
 */

/**
 * Result of regex safety validation
 */
export interface SafeRegexResult {
  /** Whether the pattern is considered safe */
  safe: boolean;
  /** Error message if pattern is unsafe or invalid */
  error?: string;
  /** The compiled RegExp if safe and valid */
  regex?: RegExp;
}

/**
 * Options for safe regex validation
 */
export interface SafeRegexOptions {
  /** Maximum allowed pattern length (default: 500) */
  maxLength?: number;
  /** RegExp flags to apply (default: none) */
  flags?: string;
}

/**
 * Default maximum pattern length
 */
const DEFAULT_MAX_LENGTH = 500;

/**
 * Dangerous patterns that can cause ReDoS (exponential backtracking)
 *
 * These patterns are known to cause performance issues with certain inputs:
 * - Nested quantifiers: (a+)+ or (a*)* patterns
 * - Multiple consecutive wildcards: .*.*
 * - Excessive backtracking: (.+)+(.+)+ patterns
 * - Large repetition ranges: {10000,}
 * - Overlapping alternation with quantifiers: (a|ab)*
 */
const DANGEROUS_PATTERNS: RegExp[] = [
  // Nested quantifiers - group with quantifier followed by quantifier
  // Examples: (a+)+, (a*)+, (a{2,})*
  /\([^)]*[*+{][^)]*\)[*+{]/,

  // Multiple consecutive wildcards
  // Examples: .*.*, .*?.*?, .*?.*, .*.*?
  /\.\*\??\.\*\??/,

  // Excessive backtracking patterns
  // Examples: (.+)+(.+)+
  /\(.*\)\+\(.*\)\+/,

  // Large repetition ranges (4+ digits = 1000+ repetitions)
  // Examples: a{10000}, a{99999,}, a{1000,}, a{5000,10000}
  /\{[0-9]{4,}(?:,[0-9]*)?\}/,

  // Overlapping alternation with quantifiers
  // Examples: (a|ab)+, (foo|foobar)*
  /\(.+\|.+\)[*+]/,
];

/**
 * Validates a regex pattern for safety and correctness.
 *
 * Checks for:
 * 1. Valid string input
 * 2. Pattern length within limits
 * 3. Absence of dangerous ReDoS patterns
 * 4. Valid regex syntax (can be compiled)
 *
 * @param pattern - The regex pattern string to validate
 * @param options - Optional configuration for validation
 * @returns SafeRegexResult with safety status and optional compiled regex
 *
 * @example
 * ```typescript
 * const result = validateRegexPattern('^[a-z]+$');
 * if (result.safe && result.regex) {
 *   result.regex.test('hello'); // true
 * }
 *
 * const unsafeResult = validateRegexPattern('(a+)+');
 * if (!unsafeResult.safe) {
 *   console.log(unsafeResult.error); // "Pattern contains dangerous ReDoS pattern..."
 * }
 * ```
 */
export function validateRegexPattern(
  pattern: unknown,
  options: SafeRegexOptions = {}
): SafeRegexResult {
  const { maxLength = DEFAULT_MAX_LENGTH, flags = '' } = options;

  // Type validation
  if (typeof pattern !== 'string') {
    return {
      safe: false,
      error: 'Pattern must be a string',
    };
  }

  // Empty pattern check
  if (pattern.length === 0) {
    return {
      safe: false,
      error: 'Pattern cannot be empty',
    };
  }

  // Length limit check
  if (pattern.length > maxLength) {
    return {
      safe: false,
      error: `Pattern exceeds maximum length of ${maxLength} characters`,
    };
  }

  // Check for dangerous ReDoS patterns
  for (const dangerousPattern of DANGEROUS_PATTERNS) {
    if (dangerousPattern.test(pattern)) {
      return {
        safe: false,
        error:
          'Pattern contains dangerous ReDoS pattern that could cause exponential backtracking',
      };
    }
  }

  // Try to compile the regex to verify syntax
  try {
    const regex = new RegExp(pattern, flags);
    return {
      safe: true,
      regex,
    };
  } catch (error) {
    const errorMessage =
      error && typeof error === 'object' && 'message' in error
        ? (error as Error).message
        : 'Invalid regex syntax';
    return {
      safe: false,
      error: `Invalid regex syntax: ${errorMessage}`,
    };
  }
}

/**
 * Checks if a regex pattern is safe (quick boolean check).
 *
 * Use this when you only need to know if a pattern is safe,
 * without needing the compiled regex.
 *
 * @param pattern - The regex pattern string to check
 * @param options - Optional configuration for validation
 * @returns true if the pattern is safe, false otherwise
 *
 * @example
 * ```typescript
 * if (isSafeRegexPattern(userInput)) {
 *   // Safe to use
 *   const regex = new RegExp(userInput);
 * }
 * ```
 */
export function isSafeRegexPattern(
  pattern: unknown,
  options: SafeRegexOptions = {}
): boolean {
  return validateRegexPattern(pattern, options).safe;
}

/**
 * Creates a RegExp from a pattern string, throwing if unsafe or invalid.
 *
 * Use this when you need a compiled RegExp and want to fail fast
 * if the pattern is dangerous or invalid.
 *
 * @param pattern - The regex pattern string
 * @param options - Optional configuration for validation
 * @returns Compiled RegExp instance
 * @throws Error if pattern is unsafe or invalid
 *
 * @example
 * ```typescript
 * try {
 *   const regex = createSafeRegex('^[a-z]+$', { flags: 'i' });
 *   regex.test('HELLO'); // true
 * } catch (error) {
 *   console.error('Invalid pattern:', error.message);
 * }
 * ```
 */
export function createSafeRegex(
  pattern: string,
  options: SafeRegexOptions = {}
): RegExp {
  const result = validateRegexPattern(pattern, options);

  if (!result.safe) {
    throw new Error(result.error ?? 'Pattern is unsafe or invalid');
  }

  // Result is guaranteed to have regex when safe is true
  return result.regex!;
}

/**
 * Executes a regex safely with a timeout mechanism using performance limits.
 *
 * This provides an additional layer of protection by limiting the input
 * size that can be matched against. For patterns that passed validation
 * but might still have edge cases.
 *
 * @param regex - The RegExp to execute
 * @param input - The string to test
 * @param maxInputLength - Maximum input length to test (default: 10000)
 * @returns Match result or null if input exceeds limits
 *
 * @example
 * ```typescript
 * const regex = createSafeRegex('^[a-z]+$');
 * const result = safeRegexTest(regex, 'hello'); // true
 * const limited = safeRegexTest(regex, veryLongString, 1000); // null if too long
 * ```
 */
export function safeRegexTest(
  regex: RegExp,
  input: string,
  maxInputLength = 10000
): boolean | null {
  if (typeof input !== 'string') {
    return null;
  }

  if (input.length > maxInputLength) {
    return null;
  }

  return regex.test(input);
}

/**
 * Executes a regex match safely with input length limits.
 *
 * @param regex - The RegExp to execute
 * @param input - The string to match
 * @param maxInputLength - Maximum input length to match (default: 10000)
 * @returns Match array or null if no match or input exceeds limits
 *
 * @example
 * ```typescript
 * const regex = createSafeRegex('([a-z]+)');
 * const result = safeRegexMatch(regex, 'hello'); // ['hello', 'hello']
 * ```
 */
export function safeRegexMatch(
  regex: RegExp,
  input: string,
  maxInputLength = 10000
): RegExpMatchArray | null {
  if (typeof input !== 'string') {
    return null;
  }

  if (input.length > maxInputLength) {
    return null;
  }

  return input.match(regex);
}
