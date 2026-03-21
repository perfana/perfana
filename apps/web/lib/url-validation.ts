/**
 * Iframe URL Validation Utility
 *
 * Provides client-side URL validation for iframe sources to prevent:
 * - JavaScript protocol injection (javascript:)
 * - Data URL attacks (data:)
 * - Untrusted external origins
 * - Non-HTTP protocols
 *
 * Use this for all iframe elements that embed external content like
 * Grafana dashboards, Pyroscope flame graphs, or tracing visualizations.
 */

/**
 * Result of iframe URL validation
 */
export interface IframeUrlValidationResult {
  /** Whether the URL is valid and safe for iframe embedding */
  isValid: boolean;
  /** Error message if URL is invalid or unsafe */
  error?: string;
  /** The parsed URL object if valid */
  url?: URL;
  /** The origin of the validated URL */
  origin?: string;
}

/**
 * Options for iframe URL validation
 */
export interface IframeUrlValidationOptions {
  /** List of allowed origins (e.g., ['https://grafana.example.com']) */
  allowedOrigins?: string[];
  /** Allow HTTP in addition to HTTPS (default: false, only allows HTTP for localhost) */
  allowHttp?: boolean;
  /** Allow localhost/127.0.0.1 origins (default: true for development) */
  allowLocalhost?: boolean;
  /** Skip origin validation (default: false) - use with caution */
  skipOriginValidation?: boolean;
}

/**
 * Dangerous protocols that should never be allowed in iframes
 */
const BLOCKED_PROTOCOLS = [
  'javascript:',
  'data:',
  'vbscript:',
  'file:',
  'ftp:',
  'blob:',
  'about:',
];

/**
 * Localhost patterns for development
 */
const LOCALHOST_PATTERNS = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '[::1]',
];

/**
 * Validates a URL for safe use in an iframe.
 *
 * Checks for:
 * 1. Valid URL format
 * 2. Allowed protocols (HTTP/HTTPS only)
 * 3. No dangerous protocols (javascript:, data:, etc.)
 * 4. Origin in allowed list (if provided)
 *
 * @param urlString - The URL string to validate
 * @param options - Optional validation configuration
 * @returns IframeUrlValidationResult with validation status
 *
 * @example
 * ```typescript
 * // Basic validation
 * const result = validateIframeUrl('https://grafana.example.com/d/abc123');
 * if (result.isValid) {
 *   return <iframe src={result.url!.toString()} />;
 * }
 *
 * // With allowed origins
 * const result = validateIframeUrl(dashboardUrl, {
 *   allowedOrigins: ['https://grafana.company.com', 'https://monitoring.company.com']
 * });
 * ```
 */
export function validateIframeUrl(
  urlString: string,
  options: IframeUrlValidationOptions = {}
): IframeUrlValidationResult {
  const {
    allowedOrigins = [],
    allowHttp = false,
    allowLocalhost = true,
    skipOriginValidation = false,
  } = options;

  // Check for empty input
  if (!urlString || typeof urlString !== 'string') {
    return {
      isValid: false,
      error: 'URL is required and must be a string',
    };
  }

  // Trim whitespace
  const trimmedUrl = urlString.trim();

  if (trimmedUrl.length === 0) {
    return {
      isValid: false,
      error: 'URL cannot be empty',
    };
  }

  // Check for blocked protocols before parsing (handles edge cases)
  const lowercaseUrl = trimmedUrl.toLowerCase();
  for (const protocol of BLOCKED_PROTOCOLS) {
    if (lowercaseUrl.startsWith(protocol)) {
      return {
        isValid: false,
        error: `Blocked protocol '${protocol}' is not allowed in iframes`,
      };
    }
  }

  // Parse URL
  let url: URL;
  try {
    url = new URL(trimmedUrl);
  } catch {
    return {
      isValid: false,
      error: 'Invalid URL format',
    };
  }

  // Check protocol after parsing (for URLs like "javascript:alert(1)")
  if (BLOCKED_PROTOCOLS.includes(url.protocol)) {
    return {
      isValid: false,
      error: `Blocked protocol '${url.protocol}' is not allowed in iframes`,
    };
  }

  // Check for HTTP/HTTPS protocols
  const hostname = url.hostname.toLowerCase();
  const isLocalhost = LOCALHOST_PATTERNS.some(
    (pattern) => hostname === pattern || hostname.endsWith(`.${pattern}`)
  );

  // Allow HTTP for localhost in development, otherwise require HTTPS
  if (url.protocol === 'http:') {
    if (!allowHttp && !(allowLocalhost && isLocalhost)) {
      return {
        isValid: false,
        error: 'HTTPS is required for iframe sources (HTTP only allowed for localhost)',
      };
    }
  } else if (url.protocol !== 'https:') {
    return {
      isValid: false,
      error: `Invalid protocol '${url.protocol}'. Only HTTP and HTTPS are allowed`,
    };
  }

  // Skip further validation if localhost and allowed
  if (isLocalhost && allowLocalhost) {
    return {
      isValid: true,
      url,
      origin: url.origin,
    };
  }

  // Origin validation
  if (!skipOriginValidation && allowedOrigins.length > 0) {
    const origin = url.origin;
    const isAllowedOrigin = allowedOrigins.some((allowed) => {
      try {
        return origin === new URL(allowed).origin;
      } catch {
        // If allowed origin is malformed, skip it
        return false;
      }
    });

    if (!isAllowedOrigin) {
      return {
        isValid: false,
        error: `Origin '${origin}' is not in the list of allowed origins`,
      };
    }
  }

  return {
    isValid: true,
    url,
    origin: url.origin,
  };
}

/**
 * Quick boolean check if a URL is safe for iframe embedding.
 *
 * Use this when you only need a pass/fail check without error details.
 *
 * @param urlString - The URL string to check
 * @param options - Optional validation configuration
 * @returns true if URL is valid and safe, false otherwise
 *
 * @example
 * ```typescript
 * if (isValidIframeUrl(dashboardUrl)) {
 *   // Safe to embed
 * }
 * ```
 */
export function isValidIframeUrl(
  urlString: string,
  options: IframeUrlValidationOptions = {}
): boolean {
  return validateIframeUrl(urlString, options).isValid;
}

/**
 * Validates a URL and throws if invalid or unsafe for iframe embedding.
 *
 * Use this when you want to fail fast on invalid URLs.
 *
 * @param urlString - The URL string to validate
 * @param options - Optional validation configuration
 * @returns The validated URL object
 * @throws Error if URL is invalid or unsafe
 *
 * @example
 * ```typescript
 * try {
 *   const url = assertValidIframeUrl(userInput);
 *   return <iframe src={url.toString()} />;
 * } catch (error) {
 *   console.error('Invalid iframe URL:', error.message);
 * }
 * ```
 */
export function assertValidIframeUrl(
  urlString: string,
  options: IframeUrlValidationOptions = {}
): URL {
  const result = validateIframeUrl(urlString, options);

  if (!result.isValid) {
    throw new Error(result.error ?? 'Invalid iframe URL');
  }

  return result.url!;
}

/**
 * Extracts the origin from a URL string.
 *
 * @param urlString - The URL string
 * @returns The origin string or null if invalid
 *
 * @example
 * ```typescript
 * const origin = extractOrigin('https://grafana.example.com/d/abc123');
 * // origin === 'https://grafana.example.com'
 * ```
 */
export function extractOrigin(urlString: string): string | null {
  try {
    const url = new URL(urlString);
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Sanitizes a URL for safe display (removes credentials).
 *
 * Use this when logging or displaying URLs to prevent credential exposure.
 *
 * @param urlString - The URL string to sanitize
 * @returns Sanitized URL string or null if invalid
 *
 * @example
 * ```typescript
 * const safe = sanitizeUrl('https://user:pass@grafana.example.com/d/abc');
 * // safe === 'https://grafana.example.com/d/abc'
 * ```
 */
export function sanitizeUrl(urlString: string): string | null {
  try {
    const url = new URL(urlString);
    // Remove credentials
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Creates a validated iframe URL with proper sandbox attributes.
 *
 * Returns both the validated URL and recommended sandbox attributes
 * for secure iframe embedding.
 *
 * @param urlString - The URL string to validate
 * @param options - Optional validation configuration
 * @returns Object with validated URL and sandbox attributes
 *
 * @example
 * ```typescript
 * const { url, sandbox, referrerPolicy } = createSecureIframeConfig(dashboardUrl);
 * return <iframe src={url} sandbox={sandbox} referrerPolicy={referrerPolicy} />;
 * ```
 */
export function createSecureIframeConfig(
  urlString: string,
  options: IframeUrlValidationOptions = {}
): {
  url: string | null;
  error?: string;
  sandbox: string;
  referrerPolicy: string;
} {
  const result = validateIframeUrl(urlString, options);

  return {
    url: result.isValid ? result.url!.toString() : null,
    error: result.error,
    // Secure sandbox attributes for embedding external dashboards
    sandbox: 'allow-scripts allow-same-origin allow-popups allow-forms',
    // Prevent referrer leakage
    referrerPolicy: 'strict-origin-when-cross-origin',
  };
}

/**
 * Builds a list of allowed origins from Grafana instance URLs.
 *
 * Use this to dynamically build the allowlist from configured instances.
 *
 * @param instanceUrls - Array of Grafana instance URLs
 * @returns Array of unique origins
 *
 * @example
 * ```typescript
 * const instances = await fetchGrafanaInstances();
 * const allowedOrigins = buildAllowedOriginsFromInstances(
 *   instances.map(i => i.clientUrl)
 * );
 * ```
 */
export function buildAllowedOriginsFromInstances(instanceUrls: string[]): string[] {
  const origins = new Set<string>();

  for (const urlString of instanceUrls) {
    const origin = extractOrigin(urlString);
    if (origin) {
      origins.add(origin);
    }
  }

  return Array.from(origins);
}
