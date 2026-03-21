/**
 * SSRF-Safe URL Validator
 *
 * Provides security utilities to validate URLs and prevent Server-Side Request
 * Forgery (SSRF) attacks. SSRF occurs when an attacker can make a server
 * issue requests to internal or sensitive resources.
 *
 * This validator blocks:
 * - Localhost and loopback addresses (127.x.x.x, ::1)
 * - Private IP ranges (10.x, 192.168.x, 172.16-31.x)
 * - Link-local addresses (169.254.x.x)
 * - Cloud metadata endpoints (169.254.169.254, metadata.google.internal)
 * - Kubernetes service discovery (.svc, .cluster.local)
 * - Non-HTTP protocols
 *
 * IMPORTANT: The @IsUrl() decorator from class-validator only validates
 * URL FORMAT, not SSRF safety. Always use this validator for external URLs.
 */

/**
 * Result of URL validation
 */
export interface UrlValidationResult {
  /** Whether the URL is valid and safe */
  isValid: boolean;
  /** Error message if URL is invalid or unsafe */
  error?: string;
  /** The parsed URL object if valid */
  url?: URL;
}

/**
 * Options for URL validation
 */
export interface UrlValidationOptions {
  /** Additional blocked hostnames (default: []) */
  blockedHosts?: string[];
  /** Additional allowed hostnames that bypass private IP check (default: []) */
  allowedHosts?: string[];
  /** Allow HTTP protocol in addition to HTTPS (default: true) */
  allowHttp?: boolean;
  /** Require HTTPS only (default: false) */
  requireHttps?: boolean;
}

/**
 * Blocked localhost and loopback hostnames
 */
const BLOCKED_LOCALHOST_HOSTS = [
  'localhost',
  'localhost.localdomain',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
  '0000:0000:0000:0000:0000:0000:0000:0001',
  '0:0:0:0:0:0:0:1',
];

/**
 * Cloud provider metadata service endpoints
 * These should never be accessed from application code
 */
const BLOCKED_METADATA_HOSTS = [
  // AWS metadata service
  '169.254.169.254',
  // GCP metadata service
  'metadata.google.internal',
  'metadata.goog',
  // Azure metadata service
  '169.254.169.254', // Same as AWS
  // DigitalOcean metadata service
  '169.254.169.254', // Same as AWS
  // Oracle Cloud metadata service
  '169.254.169.254', // Same as AWS
];

/**
 * Kubernetes service discovery suffixes
 * Block internal K8s DNS patterns
 */
const BLOCKED_K8S_SUFFIXES = [
  '.svc',
  '.svc.cluster.local',
  '.cluster.local',
  '.pod.cluster.local',
  '.internal',
];

/**
 * Allowed protocols
 */
const ALLOWED_PROTOCOLS = ['http:', 'https:'];

/**
 * Checks if an IP address is in a private range.
 * Covers RFC 1918 private ranges plus other reserved ranges.
 *
 * @param ip - IPv4 address string
 * @returns true if IP is private/reserved
 */
export function isPrivateIP(ip: string): boolean {
  // Handle IPv6-mapped IPv4 addresses (::ffff:192.168.1.1)
  const ipv4 = ip.replace(/^::ffff:/i, '');

  const parts = ipv4.split('.');
  if (parts.length !== 4) {
    // Not a valid IPv4, could be IPv6 - check common private IPv6
    return isPrivateIPv6(ip);
  }

  const octets = parts.map(Number);

  // Validate all parts are numbers in range
  if (octets.some(octet => isNaN(octet) || octet < 0 || octet > 255)) {
    return false;
  }

  const [first, second, third, _fourth] = octets;

  // 0.0.0.0/8 - Current network (only valid as source)
  if (first === 0) return true;

  // 10.0.0.0/8 - Private (Class A)
  if (first === 10) return true;

  // 100.64.0.0/10 - Carrier-grade NAT (RFC 6598)
  if (first === 100 && second >= 64 && second <= 127) return true;

  // 127.0.0.0/8 - Loopback
  if (first === 127) return true;

  // 169.254.0.0/16 - Link-local
  if (first === 169 && second === 254) return true;

  // 172.16.0.0/12 - Private (Class B)
  if (first === 172 && second >= 16 && second <= 31) return true;

  // 192.0.0.0/24 - IETF Protocol Assignments
  if (first === 192 && second === 0 && third === 0) return true;

  // 192.0.2.0/24 - TEST-NET-1
  if (first === 192 && second === 0 && third === 2) return true;

  // 192.168.0.0/16 - Private (Class C)
  if (first === 192 && second === 168) return true;

  // 198.18.0.0/15 - Benchmark testing
  if (first === 198 && (second === 18 || second === 19)) return true;

  // 198.51.100.0/24 - TEST-NET-2
  if (first === 198 && second === 51 && third === 100) return true;

  // 203.0.113.0/24 - TEST-NET-3
  if (first === 203 && second === 0 && third === 113) return true;

  // 224.0.0.0/4 - Multicast
  if (first >= 224 && first <= 239) return true;

  // 240.0.0.0/4 - Reserved for future use
  if (first >= 240 && first <= 255) return true;

  return false;
}

/**
 * Checks if an IPv6 address is in a private range.
 *
 * @param ip - IPv6 address string
 * @returns true if IP is private/reserved
 */
function isPrivateIPv6(ip: string): boolean {
  const normalizedIP = ip.toLowerCase().replace(/\[|\]/g, '');

  // Loopback (::1)
  if (normalizedIP === '::1' || normalizedIP === '0:0:0:0:0:0:0:1') {
    return true;
  }

  // Unspecified (::)
  if (normalizedIP === '::' || normalizedIP === '0:0:0:0:0:0:0:0') {
    return true;
  }

  // Link-local (fe80::/10)
  if (normalizedIP.startsWith('fe80:')) {
    return true;
  }

  // Unique local (fc00::/7) - similar to RFC 1918
  if (normalizedIP.startsWith('fc') || normalizedIP.startsWith('fd')) {
    return true;
  }

  // IPv4-mapped (::ffff:0:0/96)
  if (normalizedIP.startsWith('::ffff:')) {
    const ipv4Part = normalizedIP.replace('::ffff:', '');
    return isPrivateIP(ipv4Part);
  }

  return false;
}

/**
 * Checks if a hostname matches a blocked pattern.
 *
 * @param hostname - The hostname to check
 * @returns true if hostname is blocked
 */
function _isBlockedHostname(hostname: string): boolean {
  const normalizedHost = hostname.toLowerCase();

  // Check exact matches for localhost/metadata
  if (BLOCKED_LOCALHOST_HOSTS.includes(normalizedHost)) {
    return true;
  }

  if (BLOCKED_METADATA_HOSTS.includes(normalizedHost)) {
    return true;
  }

  // Check Kubernetes suffixes
  for (const suffix of BLOCKED_K8S_SUFFIXES) {
    if (normalizedHost.endsWith(suffix)) {
      return true;
    }
  }

  return false;
}

/**
 * Validates a URL for SSRF safety.
 *
 * Checks for:
 * 1. Valid URL format
 * 2. Allowed protocols (HTTP/HTTPS only)
 * 3. Blocked hostnames (localhost, metadata endpoints)
 * 4. Private/reserved IP ranges
 * 5. Kubernetes internal addresses
 *
 * @param urlString - The URL string to validate
 * @param options - Optional validation configuration
 * @returns UrlValidationResult with validation status
 *
 * @example
 * ```typescript
 * const result = validateUrl('https://api.example.com/data');
 * if (result.isValid) {
 *   // Safe to fetch
 *   await fetch(result.url!.toString());
 * } else {
 *   console.error(result.error);
 * }
 *
 * // Block internal access
 * const internal = validateUrl('http://localhost:8080');
 * // internal.isValid === false
 * // internal.error === 'Localhost and loopback addresses are not allowed'
 * ```
 */
export function validateUrl(
  urlString: string,
  options: UrlValidationOptions = {}
): UrlValidationResult {
  const {
    blockedHosts = [],
    allowedHosts = [],
    allowHttp = true,
    requireHttps = false,
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

  // Check protocol
  const allowedProtocols = requireHttps
    ? ['https:']
    : allowHttp
      ? ALLOWED_PROTOCOLS
      : ['https:'];

  if (!allowedProtocols.includes(url.protocol)) {
    return {
      isValid: false,
      error: `Invalid protocol '${url.protocol}'. Only ${allowedProtocols.join(', ')} allowed`,
    };
  }

  const hostname = url.hostname.toLowerCase();

  // Check if hostname is in allowed list (bypass other checks)
  if (allowedHosts.some(allowed => hostname === allowed.toLowerCase())) {
    return {
      isValid: true,
      url,
    };
  }

  // Check for blocked localhost/loopback
  if (BLOCKED_LOCALHOST_HOSTS.includes(hostname)) {
    return {
      isValid: false,
      error: 'Localhost and loopback addresses are not allowed',
    };
  }

  // Check for cloud metadata endpoints
  if (BLOCKED_METADATA_HOSTS.includes(hostname)) {
    return {
      isValid: false,
      error: 'Cloud metadata service endpoints are not allowed',
    };
  }

  // Check for Kubernetes internal addresses
  for (const suffix of BLOCKED_K8S_SUFFIXES) {
    if (hostname.endsWith(suffix)) {
      return {
        isValid: false,
        error: 'Kubernetes internal addresses are not allowed',
      };
    }
  }

  // Check for custom blocked hosts
  if (blockedHosts.some(blocked => hostname === blocked.toLowerCase())) {
    return {
      isValid: false,
      error: 'This hostname is not allowed',
    };
  }

  // Check for private/reserved IP addresses
  if (isPrivateIP(hostname)) {
    return {
      isValid: false,
      error: 'Private and reserved IP addresses are not allowed',
    };
  }

  return {
    isValid: true,
    url,
  };
}

/**
 * Quick boolean check if a URL is SSRF-safe.
 *
 * Use this when you only need a pass/fail check without error details.
 *
 * @param urlString - The URL string to check
 * @param options - Optional validation configuration
 * @returns true if URL is valid and safe, false otherwise
 *
 * @example
 * ```typescript
 * if (isValidUrl('https://api.example.com')) {
 *   // Safe to use
 * }
 * ```
 */
export function isValidUrl(
  urlString: string,
  options: UrlValidationOptions = {}
): boolean {
  return validateUrl(urlString, options).isValid;
}

/**
 * Validates a URL and throws if invalid or unsafe.
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
 *   const url = assertValidUrl(userInput);
 *   await fetch(url.toString());
 * } catch (error) {
 *   logger.error('Invalid URL provided:', error.message);
 * }
 * ```
 */
export function assertValidUrl(
  urlString: string,
  options: UrlValidationOptions = {}
): URL {
  const result = validateUrl(urlString, options);

  if (!result.isValid) {
    throw new Error(result.error ?? 'Invalid URL');
  }

  return result.url!;
}

/**
 * Validates a URL for use in iframes (stricter validation).
 *
 * Enforces HTTPS and checks against a whitelist of allowed origins.
 * Use this for embedding external content like Grafana dashboards.
 *
 * @param urlString - The URL string to validate
 * @param allowedOrigins - List of allowed origin URLs (e.g., 'https://grafana.example.com')
 * @returns UrlValidationResult with validation status
 *
 * @example
 * ```typescript
 * const trustedOrigins = [
 *   'https://grafana.example.com',
 *   'https://monitoring.example.com'
 * ];
 *
 * const result = validateIframeUrl(dashboardUrl, trustedOrigins);
 * if (result.isValid) {
 *   // Safe to embed in iframe
 * }
 * ```
 */
export function validateIframeUrl(
  urlString: string,
  allowedOrigins: string[]
): UrlValidationResult {
  // First, perform basic SSRF validation with HTTPS required
  const baseResult = validateUrl(urlString, { requireHttps: true });

  if (!baseResult.isValid) {
    return baseResult;
  }

  const url = baseResult.url!;

  // Check if origin is in allowed list
  const origin = url.origin;
  const isAllowedOrigin = allowedOrigins.some(
    allowed => origin === new URL(allowed).origin
  );

  if (!isAllowedOrigin) {
    return {
      isValid: false,
      error: `Origin '${origin}' is not in the list of allowed origins`,
    };
  }

  return {
    isValid: true,
    url,
  };
}

/**
 * Extracts and validates the origin from a URL string.
 *
 * @param urlString - The URL string
 * @returns The origin string or null if invalid
 *
 * @example
 * ```typescript
 * const origin = extractOrigin('https://example.com/path?query=1');
 * // origin === 'https://example.com'
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
 * Sanitizes a URL by removing credentials and normalizing format.
 *
 * Removes username/password from URL for safe logging or display.
 *
 * @param urlString - The URL string to sanitize
 * @returns Sanitized URL string or null if invalid
 *
 * @example
 * ```typescript
 * const safe = sanitizeUrl('https://user:pass@example.com/path');
 * // safe === 'https://example.com/path'
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
 * Validates multiple URLs and returns results for each.
 *
 * @param urls - Array of URL strings to validate
 * @param options - Optional validation configuration
 * @returns Array of validation results
 */
export function validateUrls(
  urls: string[],
  options: UrlValidationOptions = {}
): UrlValidationResult[] {
  return urls.map(url => validateUrl(url, options));
}

/**
 * Re-export types for consumers
 */
export type { UrlValidationResult as SsrfValidationResult };
