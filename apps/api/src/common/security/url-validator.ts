/**
 * URL validation utilities to prevent Server-Side Request Forgery (SSRF) attacks
 */

import { URL } from 'url';

/**
 * List of private/internal IP ranges that should be blocked
 * Includes RFC 1918 private addresses, loopback, link-local, and cloud metadata endpoints
 */
const BLOCKED_IP_PATTERNS = [
  // Loopback addresses (127.0.0.0/8)
  /^127\./,
  // Private Class A (10.0.0.0/8)
  /^10\./,
  // Private Class B (172.16.0.0/12)
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  // Private Class C (192.168.0.0/16)
  /^192\.168\./,
  // Link-local (169.254.0.0/16) - includes AWS/cloud metadata
  /^169\.254\./,
  // Localhost variations
  /^0\.0\.0\.0$/,
  /^localhost$/i,
  // IPv6 loopback
  /^::1$/,
  /^\[::1\]$/,
  // IPv6 link-local
  /^fe80:/i,
  // IPv6 unique local
  /^fc00:/i,
  /^fd[0-9a-f]{2}:/i,
];

/**
 * Cloud metadata service endpoints that should be blocked
 */
const BLOCKED_HOSTNAMES = [
  'metadata.google.internal',
  'metadata.goog',
  '169.254.169.254', // AWS/GCP/Azure metadata
  '169.254.170.2',   // AWS ECS metadata
  'fd00:ec2::254',   // AWS IPv6 metadata
];

/**
 * Allowed URL schemes
 */
const ALLOWED_SCHEMES = ['http:', 'https:'];

export interface UrlValidationResult {
  isValid: boolean;
  error?: string;
  url?: URL;
}

/**
 * Validates a URL to prevent SSRF attacks
 *
 * @param urlString - The URL string to validate
 * @param options - Validation options
 * @returns Validation result with parsed URL if valid
 */
export function validateExternalUrl(
  urlString: string,
  options: {
    allowedSchemes?: string[];
    allowedHosts?: string[];
    requireHttps?: boolean;
  } = {}
): UrlValidationResult {
  const {
    allowedSchemes = ALLOWED_SCHEMES,
    allowedHosts,
    requireHttps = false,
  } = options;

  // Parse URL
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return {
      isValid: false,
      error: 'Invalid URL format',
    };
  }

  // Check scheme
  if (!allowedSchemes.includes(url.protocol)) {
    return {
      isValid: false,
      error: `URL scheme '${url.protocol}' is not allowed. Allowed schemes: ${allowedSchemes.join(', ')}`,
    };
  }

  // Check HTTPS requirement
  if (requireHttps && url.protocol !== 'https:') {
    return {
      isValid: false,
      error: 'HTTPS is required',
    };
  }

  // Check for blocked hostnames
  const hostname = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.includes(hostname)) {
    return {
      isValid: false,
      error: 'URL hostname is blocked (potential metadata service)',
    };
  }

  // Check for blocked IP patterns
  for (const pattern of BLOCKED_IP_PATTERNS) {
    if (pattern.test(hostname)) {
      return {
        isValid: false,
        error: 'URL points to a private/internal IP address',
      };
    }
  }

  // If allowed hosts are specified, check against them
  if (allowedHosts && allowedHosts.length > 0) {
    const isAllowed = allowedHosts.some(allowed => {
      // Support wildcard subdomains (e.g., *.slack.com)
      if (allowed.startsWith('*.')) {
        const domain = allowed.slice(2).toLowerCase();
        return hostname === domain || hostname.endsWith('.' + domain);
      }
      return hostname === allowed.toLowerCase();
    });

    if (!isAllowed) {
      return {
        isValid: false,
        error: `URL hostname '${hostname}' is not in the allowed list`,
      };
    }
  }

  return {
    isValid: true,
    url,
  };
}

/**
 * Validates webhook URLs for Slack and Microsoft Teams
 *
 * @param urlString - The webhook URL to validate
 * @returns Validation result
 */
export function validateWebhookUrl(urlString: string): UrlValidationResult {
  // First do general SSRF validation
  const generalValidation = validateExternalUrl(urlString, {
    requireHttps: true,
  });

  if (!generalValidation.isValid) {
    return generalValidation;
  }

  const url = generalValidation.url!;
  const hostname = url.hostname.toLowerCase();

  // Validate known webhook providers
  const validWebhookDomains = [
    'hooks.slack.com',
    'hooks.microsoft.com',
    'outlook.office.com',
    'webhook.office.com',
    // Allow enterprise Slack instances
    '*.slack.com',
  ];

  // Check if hostname matches any valid webhook domain
  const isValidWebhook = validWebhookDomains.some(domain => {
    if (domain.startsWith('*.')) {
      const baseDomain = domain.slice(2);
      return hostname === baseDomain || hostname.endsWith('.' + baseDomain);
    }
    return hostname === domain;
  });

  if (!isValidWebhook) {
    return {
      isValid: false,
      error: `Webhook URL must be from a supported provider (Slack or Microsoft Teams). Got: ${hostname}`,
    };
  }

  return {
    isValid: true,
    url,
  };
}

/**
 * Validates Grafana instance URLs
 *
 * @param urlString - The Grafana instance URL to validate
 * @returns Validation result
 */
export function validateGrafanaUrl(urlString: string): UrlValidationResult {
  return validateExternalUrl(urlString, {
    allowedSchemes: ['http:', 'https:'],
  });
}
