import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { getRequestEm } from '../../common/db/request-em';

/**
 * Phase 5b: Lightweight health endpoint that returns the RLS posture for the
 * current request. Used by ops to confirm the interceptor is active and the
 * GUCs are populated as expected.
 *
 *   curl -H "Authorization: Bearer <token>" http://localhost:3001/api/users/me/db-context
 *
 *   {
 *     "rls": "enabled",
 *     "role": "perfana_app",
 *     "gucs": {
 *       "user_id": "kc-user-123",
 *       "organizations": "[\"org-A\",\"org-B\"]",
 *       "teams": "[]",
 *       "roles": "[\"user\"]"
 *     }
 *   }
 */
@ApiTags('users')
@Controller('users/me')
export class UsersDbContextController {
  constructor(private readonly config: ConfigService) {}

  @Get('db-context')
  @ApiOperation({ summary: 'Inspect the current request DB role + GUCs (Phase 5b)' })
  async dbContext() {
    if (this.config.get<string>('DB_ENABLE_RLS_ROLE') !== 'true') {
      return { rls: 'disabled', role: 'perfana', gucs: null };
    }
    const em = getRequestEm();
    if (!em) {
      return {
        rls: 'enabled',
        role: 'unknown',
        gucs: null,
        error: 'no request EntityManager — interceptor did not wrap this handler',
      };
    }
    const userResult = (await em.query(`SELECT current_user`)) as Array<{ current_user: string }>;
    const gucsResult = (await em.query(`
      SELECT
        current_setting('app.current_user_id', true) AS user_id,
        current_setting('app.current_user_organizations', true) AS organizations,
        current_setting('app.current_user_teams', true) AS teams,
        current_setting('app.current_user_roles', true) AS roles
    `)) as Array<{
      user_id: string;
      organizations: string;
      teams: string;
      roles: string;
    }>;
    return {
      rls: 'enabled',
      role: userResult[0]?.current_user ?? 'unknown',
      gucs: gucsResult[0] ?? null,
    };
  }
}
