import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { lastValueFrom, of, throwError } from 'rxjs';
import { DataSource } from 'typeorm';
import { AuthorizationService } from '../services/authorization.service';
import { REQ_CTX } from '../context/request-context';
import { REQ_EM } from '../db/request-em';
import { RlsTransactionInterceptor } from './rls-transaction.interceptor';

function makeInterceptor(opts: {
  flagEnabled: boolean;
  reqCtx: { userId: string } | null;
  user: { roles?: string[] } | null;
  orgs: string[];
  teams: string[];
  skipRls?: boolean;
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
    get: jest.fn().mockImplementation((key: symbol) =>
      key === REQ_CTX ? opts.reqCtx : null,
    ),
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
    switchToHttp: () => ({ getRequest: () => ({ user: opts.user }) }),
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
});
