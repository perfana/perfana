import { BlockList, isIP } from 'node:net';
import * as dns from 'node:dns';
import { request as httpsRequest, RequestOptions } from 'node:https';
import { isHostAllowlisted, normalizeHostname } from '../../common/security';

/**
 * Guards delivery to a self-hosted webhook (Mattermost) against server-side request
 * forgery.
 *
 * A Mattermost URL can name any host, and a host name says nothing about the address
 * it resolves to: `catchup.acme.com` may well point at 10.0.0.5. So the check runs on
 * the RESOLVED address, at connect time, through the `lookup` hook of the request that
 * actually sends. Resolving once to check and letting the request resolve again would
 * leave a window in which the answer can change (DNS rebinding).
 *
 * A host on the operator's allowlist (`NOTIFICATION_WEBHOOK_ALLOWED_HOSTS`) skips the
 * address check, which is how an internal Mattermost is reached. Nothing a tenant can
 * set widens it.
 */

const BLOCKED = new BlockList();
// IPv4: this-network, private, CGNAT, loopback, link-local (cloud metadata),
// IETF protocol assignments, benchmarking, multicast, reserved.
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  BLOCKED.addSubnet(net, prefix, 'ipv4');
}
// IPv6: unspecified, loopback, unique local, link-local, multicast.
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  BLOCKED.addSubnet(net, prefix, 'ipv6');
}

/** Whether an IP address is private, internal or otherwise not a public destination. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return BLOCKED.check(address, 'ipv4');
  if (family === 6) {
    // An IPv4-mapped IPv6 address (::ffff:10.0.0.1) reaches the IPv4 host.
    const mappedV4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
    if (mappedV4) return BLOCKED.check(mappedV4, 'ipv4');
    return BLOCKED.check(address, 'ipv6');
  }
  // Not an IP at all: refuse rather than guess.
  return true;
}

export class BlockedWebhookTargetError extends Error {
  constructor(hostname: string, address: string) {
    super(
      `${hostname} resolves to ${address}, a private or internal address. An administrator ` +
        'can allow this host by adding it to NOTIFICATION_WEBHOOK_ALLOWED_HOSTS.',
    );
    this.name = 'BlockedWebhookTargetError';
  }
}

type LookupAll = (
  hostname: string,
  options: { all: true },
  callback: (err: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void,
) => void;

/**
 * A `lookup` for `https.request` that refuses a blocked address unless the host is
 * allowlisted. Node calls it with or without `all: true` (autoSelectFamily), so it
 * answers in either shape.
 */
export function createGuardedLookup(
  allowedHosts: string[],
  resolveAll: LookupAll = dns.lookup as unknown as LookupAll,
): NonNullable<RequestOptions['lookup']> {
  const guarded = (
    hostname: string,
    options: dns.LookupOptions,
    callback: (...args: unknown[]) => void,
  ): void => {
    resolveAll(hostname, { all: true }, (err, addresses) => {
      if (err) {
        callback(err);
        return;
      }
      const usable = addresses.filter((a) => (options.family ? a.family === options.family : true));
      const first = usable[0];
      if (!first) {
        callback(Object.assign(new Error(`No address found for ${hostname}`), { code: 'ENOTFOUND' }));
        return;
      }
      if (!isHostAllowlisted(hostname, allowedHosts)) {
        // Refuse if ANY answer is blocked: the connection may pick any of them.
        const blocked = usable.find((a) => isBlockedAddress(a.address));
        if (blocked) {
          callback(new BlockedWebhookTargetError(hostname, blocked.address));
          return;
        }
      }
      if (options.all) {
        callback(null, usable);
      } else {
        callback(null, first.address, first.family);
      }
    });
  };
  return guarded as unknown as NonNullable<RequestOptions['lookup']>;
}

/**
 * Resolve the host the way delivery will and report whether it would be refused, so a
 * user saving the channel hears about it at once instead of at the first test run.
 */
export function checkWebhookTarget(
  hostname: string,
  allowedHosts: string[],
  resolveAll: LookupAll = dns.lookup as unknown as LookupAll,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const host = normalizeHostname(hostname);
  return new Promise((resolve) => {
    createGuardedLookup(allowedHosts, resolveAll)(host, { all: true }, ((err: Error | null) => {
      if (!err) resolve({ ok: true });
      else if (err instanceof BlockedWebhookTargetError) resolve({ ok: false, error: err.message });
      else resolve({ ok: false, error: `${host} could not be resolved from the Perfana server (${err.message})` });
    }) as never);
  });
}

const DELIVERY_TIMEOUT_MS = 10_000;
const MAX_ERROR_BODY = 500;

/**
 * POST a JSON body over HTTPS through the guarded lookup. Redirects are not followed
 * (`https.request` never does), so an allowed host cannot bounce the request to an
 * internal one.
 */
export function postJsonGuarded(
  url: string,
  body: unknown,
  allowedHosts: string[],
  resolveAll?: LookupAll,
): Promise<void> {
  const target = new URL(url);
  const hostname = normalizeHostname(target.hostname);
  // Node does not call `lookup` for an IP literal, so check one here.
  if (isIP(hostname) && !isHostAllowlisted(hostname, allowedHosts) && isBlockedAddress(hostname)) {
    return Promise.reject(new BlockedWebhookTargetError(hostname, hostname));
  }
  const payload = Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        protocol: 'https:',
        hostname,
        port: target.port || 443,
        path: target.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length },
        lookup: createGuardedLookup(allowedHosts, resolveAll),
        timeout: DELIVERY_TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          if (size < MAX_ERROR_BODY) chunks.push(chunk);
          size += chunk.length;
        });
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) {
            resolve();
          } else {
            const text = Buffer.concat(chunks).toString('utf8').slice(0, MAX_ERROR_BODY);
            reject(new Error(`Webhook request failed with status ${status}: ${text || 'no body'}`));
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error(`Webhook request timed out after ${DELIVERY_TIMEOUT_MS} ms`)));
    req.on('error', reject);
    req.end(payload);
  });
}
