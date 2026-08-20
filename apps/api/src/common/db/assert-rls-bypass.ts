import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Fails the boot if the API's login role cannot bypass row-level security.
 *
 * `AuthorizationService` resolves an API key's organization by reading `api_keys`
 * on the pooled connection, deliberately outside RLS — the read is an *input* to
 * the RLS context, so scoping it would be circular. `api_keys` is FORCE ROW LEVEL
 * SECURITY, so that read returns rows only because the login role is
 * `rolsuper`/`rolbypassrls`.
 *
 * Deploy under a least-privilege role — the stated point of `perfana_app`, or an
 * RDS master user, which is NOT bypassrls — and both api-key branches return zero
 * rows. Every API key silently loses all organization access, and it surfaces as
 * the misleading denial "user is not a member of organization X". The dependency
 * was documented in a comment; this makes it enforced.
 *
 * Postgres does not inherit role attributes through membership, so the current
 * role's own `rolsuper`/`rolbypassrls` is the thing that matters.
 */
export async function assertRlsBypass(dataSource: DataSource): Promise<void> {
  const logger = new Logger('AssertRlsBypass');

  const rows: Array<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }> =
    await dataSource.query(
      'SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
    );

  const role = rows[0];

  if (!role) {
    // current_user has no pg_roles row: cannot happen for a live connection, but
    // guessing "it's fine" here would defeat the point of the check.
    throw new Error(
      'Startup check failed: could not resolve the connected database role from pg_roles. ' +
        'Refusing to start, because API-key authentication silently returns zero ' +
        'organizations when the login role cannot bypass row-level security.',
    );
  }

  if (role.rolsuper || role.rolbypassrls) {
    logger.log(`Database role "${role.rolname}" can bypass RLS — API-key org resolution will work.`);
    return;
  }

  throw new Error(
    `Startup check failed: database role "${role.rolname}" has neither SUPERUSER nor ` +
      'BYPASSRLS. API keys resolve their organization by reading api_keys outside RLS, ' +
      'and api_keys is FORCE ROW LEVEL SECURITY — under this role that read returns zero ' +
      'rows, so every API key loses all organization access and every request is denied ' +
      'with a misleading "user is not a member of organization X". ' +
      `Grant BYPASSRLS to "${role.rolname}", or connect as a role that has it.`,
  );
}
