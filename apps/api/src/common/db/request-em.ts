import { ClsServiceManager } from 'nestjs-cls';
import { EntityManager, ObjectLiteral, Repository } from 'typeorm';

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
