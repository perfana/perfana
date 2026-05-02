import { ExecutionContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { of } from 'rxjs';
import { AuditContextInterceptor } from './audit-context.interceptor';
import { REQ_CTX, RequestContextStore } from '../context/request-context';
import { RequestContextModule } from '../context/request-context.module';

function makeCtx(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
    getHandler: () => () => undefined,
    getClass: () => class {},
    getType: () => 'http',
    getArgs: () => [],
    getArgByIndex: () => undefined,
    switchToRpc: () => ({ getData: () => ({}), getContext: () => ({}) }),
    switchToWs: () => ({ getClient: () => ({}), getData: () => ({}) }),
  } as unknown as ExecutionContext;
}

describe('AuditContextInterceptor', () => {
  let cls: ClsService;
  let interceptor: AuditContextInterceptor;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [RequestContextModule],
      providers: [AuditContextInterceptor],
    }).compile();

    cls = module.get<ClsService>(ClsService);
    interceptor = module.get<AuditContextInterceptor>(AuditContextInterceptor);
  });

  it('populates CLS store from authenticated keycloak request', (done) => {
    const req = {
      user: { sub: 'kc-user-123', email: 'daniel@perfana.io' },
      authType: 'keycloak',
      headers: {
        'user-agent': 'Mozilla/5.0',
        'x-forwarded-for': '10.42.1.7, 10.0.0.1',
      },
      ip: '127.0.0.1',
      method: 'PATCH',
      url: '/api/api-keys/abc',
    };

    cls.run(() => {
      interceptor.intercept(makeCtx(req), { handle: () => of('result') }).subscribe({
        next: () => {
          const stored = cls.get(REQ_CTX) as RequestContextStore | undefined;
          expect(stored).toBeDefined();
          expect(stored!.userId).toBe('kc-user-123');
          expect(stored!.userEmail).toBe('daniel@perfana.io');
          expect(stored!.ipAddress).toBe('10.42.1.7');
          expect(stored!.userAgent).toBe('Mozilla/5.0');
          expect(stored!.authType).toBe('keycloak');
          expect(stored!.requestId).toBeTruthy();
          done();
        },
      });
    });
  });

  it('falls back to req.ip when no X-Forwarded-For header', (done) => {
    const req = { user: { sub: 'kc-1' }, authType: 'keycloak', headers: {}, ip: '127.0.0.1' };
    cls.run(() => {
      interceptor.intercept(makeCtx(req), { handle: () => of('r') }).subscribe(() => {
        expect(cls.get<RequestContextStore>(REQ_CTX)?.ipAddress).toBe('127.0.0.1');
        done();
      });
    });
  });

  it('skips populating store for unauthenticated requests', (done) => {
    const req = { headers: {}, ip: '1.2.3.4' };
    cls.run(() => {
      interceptor.intercept(makeCtx(req), { handle: () => of('r') }).subscribe(() => {
        expect(cls.get<RequestContextStore>(REQ_CTX)).toBeUndefined();
        done();
      });
    });
  });
});
