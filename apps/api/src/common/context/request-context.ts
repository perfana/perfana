/**
 * Per-request context populated by `AuditContextInterceptor` and read by
 * `AuditService` to attach actor/IP/UA metadata to audit rows. Backed by
 * `nestjs-cls` AsyncLocalStorage.
 */
export type RequestContextStore = {
  userId: string;
  userEmail: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string;
  authType: 'keycloak' | 'api-key' | null;
};

/** CLS namespace key for the request context store. */
export const REQ_CTX = Symbol('request-context');

/** Runtime guard — used in defensive paths and tests. */
export function isRequestContextStore(value: unknown): value is RequestContextStore {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.userId === 'string'
    && (v.userEmail === null || typeof v.userEmail === 'string')
    && (v.ipAddress === null || typeof v.ipAddress === 'string')
    && (v.userAgent === null || typeof v.userAgent === 'string')
    && typeof v.requestId === 'string'
    && (v.authType === null || v.authType === 'keycloak' || v.authType === 'api-key');
}
