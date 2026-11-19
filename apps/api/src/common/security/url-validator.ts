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
 * Webhook channel types the validator knows. Kept as a plain string union so this
 * module does not depend on the entity package.
 */
export type WebhookChannelType = 'slack' | 'teams' | 'mattermost';

export interface WebhookValidationOptions {
  /**
   * Operator-configured hosts (`NOTIFICATION_WEBHOOK_ALLOWED_HOSTS`) a self-hosted
   * webhook may point at even when it is an internal address. Exact names or
   * `*.example.com`. Only consulted for Mattermost.
   */
  allowedHosts?: string[];
}

/**
 * Path of a Mattermost incoming webhook: `/hooks/<26-character id>`, optionally under
 * a sub-path when Mattermost is served from one (`/chat/hooks/<id>`). Mattermost ids
 * are 26 lowercase base32 characters. Requiring this shape means a "Mattermost"
 * channel can only POST to something that looks like a Mattermost hook, never to an
 * arbitrary endpoint.
 */
const MATTERMOST_HOOK_PATH = /^(?:\/[^/]+)*\/hooks\/[a-z0-9]{26}$/;

/** Lowercase, without a trailing dot, without IPv6 brackets. */
export function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, '').replace(/^\[(.*)\]$/, '$1');
}

/**
 * Parse the operator's allowlist: comma- or whitespace-separated host names, each an
 * exact name or `*.domain`. A full URL is accepted and reduced to its host, so pasting
 * the webhook URL itself works. Entries are normalised; empty ones are dropped.
 */
export function parseAllowedHosts(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      if (entry.includes('://')) {
        try {
          return normalizeHostname(new URL(entry).hostname);
        } catch {
          return '';
        }
      }
      return normalizeHostname(entry);
    })
    .filter(Boolean);
}

export function isHostAllowlisted(hostname: string, allowedHosts: string[] | undefined): boolean {
  if (!allowedHosts || allowedHosts.length === 0) return false;
  const host = normalizeHostname(hostname);
  return allowedHosts.some((allowed) => {
    if (allowed.startsWith('*.')) {
      const domain = allowed.slice(2);
      return host === domain || host.endsWith('.' + domain);
    }
    return host === allowed;
  });
}

/** Cloud metadata endpoints: refused even when an operator lists them. */
export function isMetadataHostname(hostname: string): boolean {
  return BLOCKED_HOSTNAMES.includes(normalizeHostname(hostname));
}

/**
 * Validates a Mattermost incoming-webhook URL, without DNS. The address the host
 * resolves to is checked when connecting (see `webhook-target-guard.ts`), because a
 * hostname says nothing about where it points.
 */
function validateMattermostWebhookUrl(
  urlString: string,
  options: WebhookValidationOptions,
): UrlValidationResult {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return { isValid: false, error: 'Invalid URL format' };
  }

  if (url.protocol !== 'https:') {
    return { isValid: false, error: 'HTTPS is required' };
  }
  if (url.username || url.password) {
    return { isValid: false, error: 'The URL must not contain credentials' };
  }
  if (url.search || url.hash) {
    return { isValid: false, error: 'A Mattermost webhook URL has no query string or fragment' };
  }
  if (!MATTERMOST_HOOK_PATH.test(url.pathname)) {
    return {
      isValid: false,
      error: 'Expected a Mattermost incoming webhook URL ending in /hooks/<26-character key>',
    };
  }

  const hostname = normalizeHostname(url.hostname);
  if (isMetadataHostname(hostname)) {
    return { isValid: false, error: 'URL hostname is blocked (potential metadata service)' };
  }
  if (isHostAllowlisted(hostname, options.allowedHosts)) {
    return { isValid: true, url };
  }
  if (BLOCKED_IP_PATTERNS.some((pattern) => pattern.test(hostname))) {
    return {
      isValid: false,
      error:
        `${hostname} is a private or internal address. An administrator can allow it ` +
        'by adding it to NOTIFICATION_WEBHOOK_ALLOWED_HOSTS.',
    };
  }
  return { isValid: true, url };
}

/**
 * Validates a notification webhook URL for its channel type.
 *
 * - Slack and Teams: HTTPS on the providers' own domains.
 * - Mattermost: self-hosted, so any HTTPS host, but the path must be a Mattermost
 *   hook and an internal address is refused unless the operator allowlisted it.
 *
 * @param urlString - The webhook URL to validate
 * @param type - The channel type; defaults to the Slack/Teams rules
 * @param options - Operator allowlist for self-hosted types
 */
export function validateWebhookUrl(
  urlString: string,
  type: WebhookChannelType = 'slack',
  options: WebhookValidationOptions = {},
): UrlValidationResult {
  if (type === 'mattermost') {
    return validateMattermostWebhookUrl(urlString, options);
  }

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
