import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { Observable, from, lastValueFrom } from 'rxjs';
import { mergeMap, toArray } from 'rxjs/operators';
import { DataSource, EntityManager } from 'typeorm';
import { AuthorizationService } from '../services/authorization.service';
import { REQ_CTX, RequestContextStore } from '../context/request-context';
import { REQ_EM, REQ_AFTER_COMMIT, AfterCommitHook } from '../db/request-em';
import { SKIP_RLS_KEY } from '../db/skip-rls.decorator';
import { AuthenticatedRequest } from '../../guards/keycloak-enhanced-auth.guard';

/**
 * Phase 5b: Wraps each authenticated request handler in a TypeORM transaction
 * and sets `SET LOCAL ROLE perfana_app` + four `SET LOCAL` GUCs so the
 * Postgres FORCE ROW LEVEL SECURITY policies can evaluate the user's
 * accessible orgs / teams / roles.
 *
 * Behavior:
 *  - Skips wrapping if `DB_ENABLE_RLS_ROLE !== 'true'`.
 *  - Skips wrapping if the request is unauthenticated (`reqCtx.userId` empty).
 *  - Skips wrapping if the handler is annotated `@SkipRls()`.
 *  - Otherwise: opens a transaction, sets role + GUCs, stores the
 *    EntityManager in CLS under `REQ_EM`, runs the handler, commits.
 *
 * Roles are read directly from `req.user.roles` (KeycloakEnhancedAuthGuard
 * populates this). The 5a CLS REQ_CTX intentionally doesn't include roles —
 * extending it would touch the audit-context interceptor; reading from
 * req.user is a smaller change.
 *
 * Streaming/SSE handlers that emit multiple values get buffered via
 * `toArray()` then re-emitted via `mergeMap`. This is correct for typical
 * REST handlers; long-lived streams MUST use `@SkipRls()`.
 */
@Injectable()
export class RlsTransactionInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RlsTransactionInterceptor.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly cls: ClsService,
    private readonly authz: AuthorizationService,
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const enabled = this.config.get<string>('DB_ENABLE_RLS_ROLE') === 'true';
    if (!enabled) return next.handle();

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_RLS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return next.handle();

    const reqCtx = this.cls.get<RequestContextStore>(REQ_CTX);
    if (!reqCtx?.userId) return next.handle();

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    // API key auth populates req.apiKey.roles; JWT auth populates req.user.roles.
    const roles = req.authType === 'api-key'
      ? (req.apiKey?.roles ?? [])
      : (req.user?.roles ?? []);

    const [orgs, teams] = await Promise.all([
      this.authz.getAccessibleOrganizations(reqCtx.userId),
      this.authz.getAccessibleTeams(reqCtx.userId),
    ]);

    const dataSource = this.dataSource;
    const cls = this.cls;
    const logger = this.logger;

    return from(
      dataSource
        .transaction(async (em: EntityManager) => {
        await em.query(`SET LOCAL ROLE perfana_app`);
        await em.query(
          `SELECT set_config('app.current_user_id', $1, true)`,
          [reqCtx.userId],
        );
        await em.query(
          `SELECT set_config('app.current_user_organizations', $1, true)`,
          [JSON.stringify(orgs)],
        );
        await em.query(
          `SELECT set_config('app.current_user_teams', $1, true)`,
          [JSON.stringify(teams)],
        );
        await em.query(
          `SELECT set_config('app.current_user_roles', $1, true)`,
          [JSON.stringify(roles)],
        );
        cls.set(REQ_EM, em);
        try {
          // Buffer all emissions inside the transaction. For typical REST
          // handlers this is a single value; @SkipRls()-marked endpoints
          // bypass this entirely.
          return await lastValueFrom(next.handle().pipe(toArray()));
        } catch (err) {
          logger.warn(
            `request rolled back inside RLS transaction: ${err instanceof Error ? err.message : err}`,
          );
          throw err;
        }
      })
        .then(async (values) => {
          // Transaction committed. Run deferred hooks (e.g. BullMQ enqueues)
          // so their workers can read rows written during the request.
          const hooks = cls.get<AfterCommitHook[]>(REQ_AFTER_COMMIT) ?? [];
          cls.set(REQ_AFTER_COMMIT, []);
          for (const hook of hooks) {
            try {
              await hook();
            } catch (err) {
              logger.warn(
                `after-commit hook failed: ${err instanceof Error ? err.message : err}`,
              );
            }
          }
          return values;
        }),
    ).pipe(
      // Re-emit the buffered values so downstream observers see them.
      // For single-value handlers this is a one-element array → one emission.
      mergeMap((values: unknown[]) => values),
    );
  }
}
