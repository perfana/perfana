import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { lastValueFrom, of, throwError } from 'rxjs';
import { DataSource } from 'typeorm';
import { AuthorizationService } from '../services/authorization.service';
import { REQ_CTX } from '../context/request-context';
import { REQ_EM, REQ_AFTER_COMMIT } from '../db/request-em';
import { RlsTransactionInterceptor } from './rls-transaction.interceptor';

function makeInterceptor(opts: {
  flagEnabled: boolean;
  reqCtx: { userId: string } | null;
  user: { roles?: string[] } | null;
  orgs: string[];
  teams: string[];
  skipRls?: boolean;
  authType?: 'api-key' | 'keycloak-jwt';
  apiKey?: { roles: string[] };
  afterCommitHooks?: Array<() => void | Promise<void>>;
}) {
  const queries: Array<{ q: string; params?: unknown[] }> = [];
  const txn = jest.fn(async (cb: (em: unknown) => Promise<unknown>) => {
    const em = {
      query: (q: string, params?: unknown[]) => {
        queries.push({ q, params });
        return Promise.resolve();
      },
    };
    return cb(em);
  });

  const dataSource = { transaction: txn } as unknown as DataSource;
  const cls = {
    get: jest.fn().mockImplementation((key: symbol) => {
      if (key === REQ_CTX) return opts.reqCtx;
      if (key === REQ_AFTER_COMMIT) return opts.afterCommitHooks ?? null;
      return null;
    }),
    set: jest.fn(),
  } as unknown as ClsService;
  const authz = {
    getAccessibleOrganizations: jest.fn().mockResolvedValue(opts.orgs),
    getAccessibleTeams: jest.fn().mockResolvedValue(opts.teams),
  } as unknown as AuthorizationService;
  const config = {
    get: jest.fn().mockReturnValue(opts.flagEnabled ? 'true' : 'false'),
  } as unknown as ConfigService;
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(opts.skipRls ?? false),
  } as unknown as Reflector;

  const interceptor = new RlsTransactionInterceptor(
    dataSource, cls, authz, config, reflector,
  );

  const ctx = {
    switchToHttp: () => ({
      getRequest: () => ({
        user: opts.user,
        authType: opts.authType,
        apiKey: opts.apiKey,
      }),
    }),
    getHandler: () => () => undefined,
    getClass: () => class C {},
  } as unknown as Parameters<typeof interceptor.intercept>[0];

  return { interceptor, ctx, queries, txn, cls, authz };
}

describe('RlsTransactionInterceptor', () => {
  it('skips wrapping when DB_ENABLE_RLS_ROLE=false', async () => {
    const { interceptor, ctx, txn } = makeInterceptor({
      flagEnabled: false, reqCtx: { userId: 'u1' }, user: { roles: ['user'] }, orgs: [], teams: [],
    });
    const next = { handle: () => of('result') };
    const obs = await interceptor.intercept(ctx, next);
    expect(await lastValueFrom(obs)).toBe('result');
    expect(txn).not.toHaveBeenCalled();
  });

  it('skips wrapping for unauthenticated requests', async () => {
    const { interceptor, ctx, txn } = makeInterceptor({
      flagEnabled: true, reqCtx: null, user: null, orgs: [], teams: [],
    });
    const next = { handle: () => of('result') };
    const obs = await interceptor.intercept(ctx, next);
    expect(await lastValueFrom(obs)).toBe('result');
    expect(txn).not.toHaveBeenCalled();
  });

  it('skips wrapping for @SkipRls()-annotated handlers', async () => {
    const { interceptor, ctx, txn } = makeInterceptor({
      flagEnabled: true, reqCtx: { userId: 'u1' }, user: { roles: ['user'] },
      orgs: [], teams: [], skipRls: true,
    });
    const next = { handle: () => of('result') };
    const obs = await interceptor.intercept(ctx, next);
    expect(await lastValueFrom(obs)).toBe('result');
    expect(txn).not.toHaveBeenCalled();
  });

  it('wraps the handler in a transaction with role + GUCs set', async () => {
    const { interceptor, ctx, txn, queries, cls } = makeInterceptor({
      flagEnabled: true,
      reqCtx: { userId: 'u1' },
      user: { roles: ['user', 'org-member'] },
      orgs: ['org-A', 'org-B'],
      teams: [],
    });
    const next = { handle: () => of('handler-result') };
    const obs = await interceptor.intercept(ctx, next);
    const result = await lastValueFrom(obs);
    expect(result).toBe('handler-result');
    expect(txn).toHaveBeenCalledTimes(1);
    expect(queries[0].q).toBe('SET LOCAL ROLE perfana_app');
    expect(queries[1]).toEqual({
      q: `SELECT set_config('app.current_user_id', $1, true)`,
      params: ['u1'],
    });
    expect(queries[2]).toEqual({
      q: `SELECT set_config('app.current_user_organizations', $1, true)`,
      params: ['["org-A","org-B"]'],
    });
    expect(queries[3]).toEqual({
      q: `SELECT set_config('app.current_user_teams', $1, true)`,
      params: ['[]'],
    });
    expect(queries[4]).toEqual({
      q: `SELECT set_config('app.current_user_roles', $1, true)`,
      params: ['["user","org-member"]'],
    });
    expect(cls.set).toHaveBeenCalledWith(REQ_EM, expect.any(Object));
  });

  it('runs after-commit hooks once the transaction commits (#421)', async () => {
    const order: string[] = [];
    const hook = jest.fn(async () => {
      order.push('hook');
    });
    const { interceptor, ctx } = makeInterceptor({
      flagEnabled: true, reqCtx: { userId: 'u1' }, user: { roles: ['user'] },
      orgs: [], teams: [], afterCommitHooks: [hook],
    });
    const next = { handle: () => { order.push('handler'); return of('ok'); } };
    const obs = await interceptor.intercept(ctx, next);
    expect(await lastValueFrom(obs)).toBe('ok');
    expect(hook).toHaveBeenCalledTimes(1);
    // Hook runs after the handler (i.e. after commit), never before.
    expect(order).toEqual(['handler', 'hook']);
  });

  it('a failing after-commit hook does not fail the response', async () => {
    const { interceptor, ctx } = makeInterceptor({
      flagEnabled: true, reqCtx: { userId: 'u1' }, user: { roles: ['user'] },
      orgs: [], teams: [],
      afterCommitHooks: [jest.fn().mockRejectedValue(new Error('enqueue boom'))],
    });
    const next = { handle: () => of('ok') };
    const obs = await interceptor.intercept(ctx, next);
    expect(await lastValueFrom(obs)).toBe('ok');
  });

  it('rolls back when the handler throws', async () => {
    const { interceptor, ctx, txn } = makeInterceptor({
      flagEnabled: true, reqCtx: { userId: 'u1' }, user: { roles: ['user'] },
      orgs: [], teams: [],
    });
    const next = { handle: () => throwError(() => new Error('handler boom')) };
    const obs = await interceptor.intercept(ctx, next);
    await expect(lastValueFrom(obs)).rejects.toThrow('handler boom');
    expect(txn).toHaveBeenCalledTimes(1);
  });

  it('reads roles from req.apiKey.roles when authType is api-key', async () => {
    const { interceptor, ctx, queries } = makeInterceptor({
      flagEnabled: true,
      reqCtx: { userId: 'api-key:k1' },
      user: null,
      orgs: ['org-X'],
      teams: [],
      authType: 'api-key',
      apiKey: { roles: ['org-admin'] },
    });
    const next = { handle: () => of('ok') };
    const obs = await interceptor.intercept(ctx, next);
    await lastValueFrom(obs);
    const rolesQuery = queries.find(q => q.q.includes('current_user_roles'));
    expect(rolesQuery?.params).toEqual(['["org-admin"]']);
  });

  it('falls back to empty roles when authType is api-key but apiKey is absent', async () => {
    const { interceptor, ctx, queries } = makeInterceptor({
      flagEnabled: true,
      reqCtx: { userId: 'api-key:k2' },
      user: null,
      orgs: [],
      teams: [],
      authType: 'api-key',
      apiKey: undefined,
    });
    const next = { handle: () => of('ok') };
    const obs = await interceptor.intercept(ctx, next);
    await lastValueFrom(obs);
    const rolesQuery = queries.find(q => q.q.includes('current_user_roles'));
    expect(rolesQuery?.params).toEqual(['[]']);
  });
});
