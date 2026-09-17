import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { NextFunction, Request, Response } from 'express';
import { DataSource } from 'typeorm';
import { BullMQClientService } from '../../modules/data-science/services/bullmq-client.service';

export const DEFAULT_SLOW_REQUEST_MS = 1000;

/**
 * Logs every request slower than SLOW_REQUEST_MS with the two things most likely to
 * explain it: the pg pool state (`waiting > 0` means pool exhaustion, not a slow query)
 * and the worker jobs active at that moment (a heavy aggregation evicting the buffer
 * cache shows up here as "slow everything, no slow query").
 *
 * A middleware rather than an interceptor so the clock starts before the guards:
 * `KeycloakEnhancedAuthGuard` waits on the same pg pool for an API-key lookup, and a
 * 401/403/429 never reaches an interceptor at all. Timed on the response's `close`,
 * which fires after the status is final and the body is sent, and also when the client
 * gives up on a request that never finished.
 */
@Injectable()
export class SlowRequestMiddleware implements NestMiddleware {
  private readonly logger = new Logger('SlowRequest');
  private readonly thresholdMs: number;

  constructor(
    config: ConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly bullmq: BullMQClientService,
  ) {
    // '' (compose `${VAR:-}`), 'abc' and negatives would otherwise log every request.
    const parsed = Number(config.get('SLOW_REQUEST_MS'));
    this.thresholdMs = parsed > 0 ? parsed : DEFAULT_SLOW_REQUEST_MS;
  }

  use(req: Request, res: Response, next: NextFunction): void {
    const start = Date.now();
    res.once('close', () => {
      const ms = Date.now() - start;
      if (ms < this.thresholdMs) return;
      // An SSE stream is open for as long as the viewer watches it; that is not slowness.
      if (String(res.getHeader('content-type') ?? '').startsWith('text/event-stream')) return;
      const status = res.writableFinished ? res.statusCode : 'aborted';
      // Snapshot the pool NOW, not after the Redis round trip — it is the number that
      // distinguishes pool exhaustion, and it must describe this request's moment.
      const pool = this.poolState();
      this.bullmq
        .describeActiveJobs()
        .then((jobs) => this.logger.warn(`${req.method} ${req.originalUrl ?? req.url} ${status} ${ms}ms pool=${pool} jobs=${jobs}`))
        .catch(() => undefined); // off the request path: a throw here would be an unhandled rejection
    });
    next();
  }

  private poolState(): string {
    // pg.Pool exposes these; TypeORM's PostgresDriver keeps it as `master` (verified on typeorm 0.3.x).
    const pool = (this.dataSource?.driver as { master?: { totalCount?: number; idleCount?: number; waitingCount?: number } } | undefined)?.master;
    return pool ? `${pool.totalCount}/${pool.idleCount}idle/${pool.waitingCount}waiting` : 'n/a';
  }
}
