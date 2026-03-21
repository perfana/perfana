import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { AuditService } from '../../modules/audit/audit.service';
import { KeycloakEnhancedAuthGuard, AuthenticatedRequest } from '../../guards/keycloak-enhanced-auth.guard';
import { AuditAction, AuditLogMetadata } from '@perfana/shared/entities';

/**
 * Routes/paths that should not be audited
 * These are typically health checks, metrics, and documentation endpoints
 */
const EXCLUDED_PATHS = [
  '/health',
  '/metrics',
  '/docs',
  '/api/docs',
  '/api/health',
  '/favicon.ico',
];

/**
 * HTTP methods that should not be audited (read-only non-essential)
 */
const EXCLUDED_METHODS = ['OPTIONS', 'HEAD'];

/**
 * AuditInterceptor
 *
 * Global interceptor for automatic CRUD operation logging.
 * Part of RBAC Phase 5: Row-Level Security, Audit Logging & Hardening.
 *
 * Key Features:
 * - Automatically logs all CRUD operations (CREATE, UPDATE, DELETE, ACCESS)
 * - Fire-and-forget pattern (doesn't block request processing)
 * - Extracts user context from authenticated requests
 * - Captures IP address, user agent, and request metadata
 * - Handles both success and failure scenarios
 *
 * Excluded Endpoints:
 * - Health checks (/health, /api/health)
 * - Metrics endpoints (/metrics)
 * - Documentation (/docs, /api/docs)
 * - OPTIONS and HEAD requests
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(private readonly auditService: AuditService) {
    this.logger.log('Audit Interceptor initialized');
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const startTime = Date.now();

    // Skip excluded paths and methods
    if (this.shouldSkipAudit(request)) {
      return next.handle();
    }

    // Extract audit context before handler execution
    const auditContext = this.extractAuditContext(request);

    return next.handle().pipe(
      tap(() => {
        // Log successful operation (fire-and-forget)
        this.logAudit(auditContext, true, undefined, startTime);
      }),
      catchError((error) => {
        // Log failed operation (fire-and-forget)
        const errorMessage = this.extractErrorMessage(error);
        this.logAudit(auditContext, false, errorMessage, startTime);
        return throwError(() => error);
      }),
    );
  }

  /**
   * Determine if the request should be skipped for auditing
   */
  private shouldSkipAudit(request: AuthenticatedRequest): boolean {
    const method = request.method?.toUpperCase();
    const path = request.path || request.url;

    // Skip excluded methods
    if (EXCLUDED_METHODS.includes(method)) {
      return true;
    }

    // Skip excluded paths
    for (const excludedPath of EXCLUDED_PATHS) {
      if (path.startsWith(excludedPath)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Extract audit context from the request
   */
  private extractAuditContext(request: AuthenticatedRequest): AuditContext {
    const userId = KeycloakEnhancedAuthGuard.getUserId(request) || 'anonymous';
    const userEmail = KeycloakEnhancedAuthGuard.getUserEmail(request) || undefined;
    const method = request.method?.toUpperCase() || 'UNKNOWN';
    const path = request.path || request.url || '/';
    const action = this.mapHttpMethodToAuditAction(method);

    // Extract resource information from path
    const { resourceType, resourceId } = this.extractResourceFromPath(path);

    // Extract client information
    const ipAddress = this.extractIpAddress(request);
    const userAgentRaw = request.headers?.['user-agent'];
    const userAgent = Array.isArray(userAgentRaw) ? userAgentRaw[0] : userAgentRaw;

    // Build metadata
    const metadata: AuditLogMetadata = {
      route: path,
      method,
      auth_type: request.authType,
    };

    return {
      userId,
      userEmail,
      action,
      resourceType,
      resourceId,
      ipAddress,
      userAgent,
      metadata,
    };
  }

  /**
   * Map HTTP method to AuditAction enum
   */
  private mapHttpMethodToAuditAction(method: string): AuditAction {
    switch (method) {
      case 'POST':
        return AuditAction.CREATE;
      case 'PUT':
      case 'PATCH':
        return AuditAction.UPDATE;
      case 'DELETE':
        return AuditAction.DELETE;
      case 'GET':
      default:
        return AuditAction.ACCESS;
    }
  }

  /**
   * Extract resource type and ID from request path
   * Examples:
   *   /api/test-runs/123 -> { resourceType: 'test-runs', resourceId: '123' }
   *   /api/api-keys -> { resourceType: 'api-keys', resourceId: undefined }
   */
  private extractResourceFromPath(path: string): {
    resourceType: string;
    resourceId: string | undefined;
  } {
    // Remove leading /api/ if present
    const cleanPath = path.replace(/^\/api\//, '').replace(/^\//, '');

    // Split path into segments
    const segments = cleanPath.split('/').filter((s) => s.length > 0);

    if (segments.length === 0) {
      return { resourceType: 'root', resourceId: undefined };
    }

    // First segment is typically the resource type
    const resourceType = segments[0]!; // Non-null assertion: we checked length > 0

    // Second segment (if exists and looks like an ID) is the resource ID
    let resourceId: string | undefined;
    if (segments.length > 1) {
      const potentialId = segments[1]!; // Non-null assertion: we checked length > 1
      // Check if it looks like a UUID or numeric ID
      if (this.looksLikeId(potentialId)) {
        resourceId = potentialId;
      }
    }

    return { resourceType, resourceId };
  }

  /**
   * Check if a string looks like a resource ID (UUID or numeric)
   */
  private looksLikeId(value: string): boolean {
    // UUID pattern
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidPattern.test(value)) {
      return true;
    }

    // Numeric ID
    if (/^\d+$/.test(value)) {
      return true;
    }

    // Short alphanumeric ID (common in some systems)
    if (/^[a-zA-Z0-9]{8,}$/.test(value) && value.length <= 36) {
      return true;
    }

    return false;
  }

  /**
   * Extract client IP address from request
   * Handles proxied requests (X-Forwarded-For, X-Real-IP)
   */
  private extractIpAddress(request: AuthenticatedRequest): string | undefined {
    // Check for proxy headers first
    const forwardedFor = request.headers?.['x-forwarded-for'];
    if (forwardedFor) {
      // X-Forwarded-For can be a comma-separated list; take the first one
      const ips = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
      if (ips) {
        const firstIp = ips.split(',')[0];
        return firstIp ? firstIp.trim() : undefined;
      }
    }

    const realIp = request.headers?.['x-real-ip'];
    if (realIp) {
      return Array.isArray(realIp) ? realIp[0] : realIp;
    }

    // Fall back to socket remote address
    return request.ip || request.connection?.remoteAddress;
  }

  /**
   * Extract error message from caught error
   */
  private extractErrorMessage(error: unknown): string {
    if (error && typeof error === 'object' && 'message' in error) {
      return (error as Error).message;
    }
    return 'Unknown error';
  }

  /**
   * Log the audit event using fire-and-forget pattern
   */
  private logAudit(
    context: AuditContext,
    success: boolean,
    errorMessage: string | undefined,
    startTime: number,
  ): void {
    const durationMs = Date.now() - startTime;

    // Add duration to metadata
    const metadata: AuditLogMetadata = {
      ...context.metadata,
      duration_ms: durationMs,
    };

    // Fire-and-forget: don't await, catch errors silently
    this.auditService
      .log({
        userId: context.userId,
        userEmail: context.userEmail,
        action: context.action,
        resourceType: context.resourceType,
        resourceId: context.resourceId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata,
        success,
        errorMessage,
      })
      .catch(() => {
        // Silently ignore - AuditService already logs errors internally
      });
  }
}

/**
 * Internal interface for audit context
 */
interface AuditContext {
  userId: string;
  userEmail: string | undefined;
  action: AuditAction;
  resourceType: string;
  resourceId: string | undefined;
  ipAddress: string | undefined;
  userAgent: string | undefined;
  metadata: AuditLogMetadata;
}
