import { ClsServiceManager } from 'nestjs-cls';
import { DataSource, EntityManager, ObjectLiteral, Repository } from 'typeorm';

/**
 * Phase 5b: CLS namespace key for the per-request, transaction-scoped
 * EntityManager populated by RlsTransactionInterceptor.
 *
 * When `DB_ENABLE_RLS_ROLE=true`, every authenticated request runs inside
 * a transaction with `SET LOCAL ROLE perfana_app` and four `SET LOCAL`
 * GUCs. The interceptor stores the transaction's EntityManager here;
 * services pull it back via `withRequestEm()` so their queries inherit
 * the role + GUCs.
 *
 * When the flag is off (or the request is unauthenticated), the CLS slot
 * is empty and `withRequestEm()` falls back to the original repository.
 */
export const REQ_EM = Symbol('rls-request-entity-manager');

/**
 * CLS key for callbacks that must run AFTER the per-request RLS transaction
 * commits. Drained by RlsTransactionInterceptor. See runAfterRequestCommit.
 */
export const REQ_AFTER_COMMIT = Symbol('rls-after-commit-hooks');

export type AfterCommitHook = () => void | Promise<void>;

/**
 * Returns the request-scoped EntityManager if one is in CLS, otherwise null.
 * Outside an HTTP request (worker, scheduled job, test), CLS isn't initialized
 * and this returns null — callers fall through to default repos.
 */
export function getRequestEm(): EntityManager | null {
  try {
    return ClsServiceManager.getClsService().get<EntityManager>(REQ_EM) ?? null;
  } catch {
    // ClsService not initialized (e.g., unit-test context): no request EM.
    return null;
  }
}

/**
 * Returns a Repository<T> bound to the request-scoped EntityManager when
 * available, falling back to the input repository otherwise.
 *
 *   // BEFORE
 *   await this.apiKeyRepo.find({ where: { organizationId } });
 *
 *   // AFTER
 *   await withRequestEm(this.apiKeyRepo).find({ where: { organizationId } });
 *
 * Identity-transparent when DB_ENABLE_RLS_ROLE=false: returns `repo` unchanged.
 */
export function withRequestEm<T extends ObjectLiteral>(repo: Repository<T>): Repository<T> {
  const em = getRequestEm();
  if (!em) return repo;
  return em.getRepository(repo.target);
}

/**
 * Returns a raw-query executor bound to the request-scoped EntityManager when
 * available, falling back to the DataSource's default manager otherwise. Use
 * for raw `.query(...)` writes that have no repository to hang off of (e.g.
 * JTL import metric inserts) but MUST run on the same connection/transaction
 * that created earlier rows in the request — otherwise the write lands on a
 * separate pooled connection where those rows are still uncommitted (FK
 * violations) and autocommits independently (orphaned rows that survive a
 * request rollback).
 *
 *   // BEFORE
 *   await this.dataSource.query(sql, params);
 *
 *   // AFTER
 *   await withRequestQuery(this.dataSource).query(sql, params);
 *
 * Identity-transparent when DB_ENABLE_RLS_ROLE=false / outside an HTTP request:
 * returns `dataSource.manager`, which queries on a pooled connection exactly
 * like `dataSource.query` did.
 */
export function withRequestQuery(dataSource: DataSource): EntityManager {
  return getRequestEm() ?? dataSource.manager;
}

/**
 * Defers `fn` until the current request's RLS transaction has committed, so it
 * observes the rows written during the request. Use for enqueuing BullMQ jobs
 * whose worker reads a row created in the same request — enqueuing inline races
 * the commit and the worker sees "not found" on a different connection.
 *
 * When there is no request transaction (RLS off, unauthenticated, @SkipRls, or
 * outside an HTTP request) the writes already autocommitted, so `fn` runs
 * immediately (fire-and-forget; it must handle its own errors).
 */
export function runAfterRequestCommit(fn: AfterCommitHook): void {
  const em = getRequestEm();
  if (!em) {
    void Promise.resolve().then(fn);
    return;
  }
  const cls = ClsServiceManager.getClsService();
  const hooks = cls.get<AfterCommitHook[]>(REQ_AFTER_COMMIT) ?? [];
  hooks.push(fn);
  cls.set(REQ_AFTER_COMMIT, hooks);
}
