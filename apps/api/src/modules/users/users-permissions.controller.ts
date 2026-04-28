import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthorizationService } from '../../common/services/authorization.service';
import { CapabilityValue } from '../../constants/capabilities.constants';
import { UserCtx, UserContext } from '../../common/decorators/user-context.decorator';
import { PermissionsResponseDto } from './dto/permissions-response.dto';

@ApiTags('users')
@Controller('users/me')
export class UsersPermissionsController {
  constructor(private readonly authzService: AuthorizationService) {}

  @Get('permissions')
  @ApiOperation({
    summary: "Get the current user's capability set",
    description:
      'Returns global capabilities (independent of org) and per-organization capabilities for ' +
      'every org the user belongs to. The frontend uses this to gate UI actions.',
  })
  async getMyPermissions(@UserCtx() ctx: UserContext): Promise<PermissionsResponseDto> {
    const orgIds = await this.authzService.getAccessibleOrganizations(ctx.userId);

    // Fan out the per-org capability lookups in parallel. Each call hits Redis
    // (cached) or Postgres (cold cache). Serial would be N round-trips for a
    // user with N orgs; Promise.all keeps p99 at one round-trip's latency
    // regardless of org count.
    const [global, ...orgCaps] = await Promise.all([
      this.authzService.getCapabilities(ctx.userId, ctx.roles, null),
      ...orgIds.map((orgId) =>
        this.authzService.getCapabilities(ctx.userId, ctx.roles, orgId),
      ),
    ]);

    const byOrg: Record<string, CapabilityValue[]> = {};
    orgIds.forEach((orgId, i) => {
      byOrg[orgId] = orgCaps[i] ?? [];
    });

    return { userId: ctx.userId, global, byOrg };
  }
}
