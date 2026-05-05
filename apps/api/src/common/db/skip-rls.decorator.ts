import { SetMetadata } from '@nestjs/common';

/**
 * Phase 5b: Marks a controller method as exempt from the
 * RlsTransactionInterceptor. The interceptor will check this metadata
 * via Reflector and skip the transaction wrap, leaving the request to
 * run on a non-transactional connection.
 *
 * Use sparingly — typically only for streaming/SSE endpoints that hold
 * the response open for minutes. The endpoint must NOT touch RLS-
 * protected tables (or it must do so via an explicit transactional
 * helper that opens its own short-lived RLS transaction internally).
 *
 *   @Get('events/stream')
 *   @SkipRls()
 *   async stream(@Res() res: Response) {
 *     // ... long-lived SSE stream
 *   }
 */
export const SKIP_RLS_KEY = 'skip-rls';
export const SkipRls = (): MethodDecorator => SetMetadata(SKIP_RLS_KEY, true);
