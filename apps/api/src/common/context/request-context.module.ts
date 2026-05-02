import { Module } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ClsModule } from 'nestjs-cls';

/**
 * Wraps `nestjs-cls` for the API: registers the CLS module as global with a
 * UUIDv4 request-id generator. AuditContextInterceptor writes into the store;
 * AuditService reads from it.
 */
@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        generateId: true,
        idGenerator: () => randomUUID(),
      },
    }),
  ],
  exports: [ClsModule],
})
export class RequestContextModule {}
