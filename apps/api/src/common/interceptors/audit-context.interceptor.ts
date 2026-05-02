import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { Observable } from 'rxjs';
import { randomUUID } from 'crypto';
import { REQ_CTX, RequestContextStore } from '../context/request-context';

/**
 * AuditContextInterceptor (Phase 5a)
 *
 * Replaces the legacy `AuditInterceptor`. This interceptor's only job is to
 * populate the per-request CLS store with `{userId, userEmail, ipAddress,
 * userAgent, requestId, authType}`. It does NOT write audit rows — those are
 * emitted by service-layer `auditService.log{Create,Update,Delete}` calls.
 *
 * Skips population for unauthenticated requests (login, public endpoints).
 */
@Injectable()
export class AuditContextInterceptor implements NestInterceptor {
  constructor(private readonly cls: ClsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{
      user?: { sub?: string; email?: string };
      authType?: 'keycloak' | 'api-key';
      headers?: Record<string, string | string[] | undefined>;
      ip?: string;
      connection?: { remoteAddress?: string };
    }>();

    const userId = req.user?.sub;
    if (userId) {
      const store: RequestContextStore = {
        userId,
        userEmail: req.user?.email ?? null,
        ipAddress: this.extractIp(req),
        userAgent: this.extractUserAgent(req),
        requestId: randomUUID(),
        authType: req.authType ?? null,
      };
      this.cls.set(REQ_CTX, store);
    }

    return next.handle();
  }

  private extractIp(req: { headers?: Record<string, string | string[] | undefined>; ip?: string; connection?: { remoteAddress?: string } }): string | null {
    const xff = req.headers?.['x-forwarded-for'];
    if (xff) {
      const raw = Array.isArray(xff) ? xff[0] : xff;
      const first = raw?.split(',')[0]?.trim();
      if (first) return first;
    }
    const xri = req.headers?.['x-real-ip'];
    if (xri) return Array.isArray(xri) ? xri[0]! : xri;
    return req.ip ?? req.connection?.remoteAddress ?? null;
  }

  private extractUserAgent(req: { headers?: Record<string, string | string[] | undefined> }): string | null {
    const ua = req.headers?.['user-agent'];
    if (Array.isArray(ua)) return ua[0] ?? null;
    return ua ?? null;
  }
}
