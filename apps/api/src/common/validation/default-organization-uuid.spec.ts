import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateTeamDto, UpdateTeamDto } from '../../modules/teams/dto/team.dto';
import { CreateApiKeyDto } from '../../modules/api-keys/dto/create-api-key.dto';
import { CreateAlertTagFilterDto } from '../../modules/alerts/dto/alert-tag-filter.dto';
import { AuditFilterDto } from '../../modules/audit/dto/audit-filter.dto';
import { CreateEventDto } from '../../modules/events/dto/event.dto';
import { CreateMetricsSourceDto } from '../../modules/metrics-sources/dto/create-metrics-source.dto';
import { UpdateMetricsSourceDto } from '../../modules/metrics-sources/dto/update-metrics-source.dto';
import { CreateSystemUnderTestDto } from '../../modules/systems-under-test/dto/create-system-under-test.dto';

/**
 * TODOS.md P2, "Strict `@IsUUID()` refuses the Default Organization".
 * The seeded Default Organization is 00000000-0000-0000-0000-000000000001, which has no RFC 4122
 * version or variant nibble, so class-validator's default (strict) isUUID refuses it and every create
 * or filter naming it answered 400. Organization and team ids are validated 'loose', as ParseUUIDPipe
 * and CreateProfileDto already were.
 * Value: protects=the Default Organization can be named wherever an organization or team id is taken;
 * fails_when=one of these fields goes back to a bare @IsUUID(); seam=class-validator on the DTO classes.
 */
const DEFAULT_ORG = '00000000-0000-0000-0000-000000000001';

const cases: Array<[string, new () => object, Record<string, unknown>, string]> = [
  ['CreateTeamDto', CreateTeamDto, { name: 'Team', organization_id: DEFAULT_ORG }, 'organization_id'],
  ['UpdateTeamDto', UpdateTeamDto, { organization_id: DEFAULT_ORG }, 'organization_id'],
  ['CreateApiKeyDto', CreateApiKeyDto, { organizationId: DEFAULT_ORG }, 'organizationId'],
  ['CreateAlertTagFilterDto', CreateAlertTagFilterDto, { organizationId: DEFAULT_ORG }, 'organizationId'],
  ['AuditFilterDto', AuditFilterDto, { organizationId: DEFAULT_ORG }, 'organizationId'],
  ['CreateEventDto', CreateEventDto, { organizationId: DEFAULT_ORG }, 'organizationId'],
  ['CreateMetricsSourceDto (organization)', CreateMetricsSourceDto, { organizationId: DEFAULT_ORG }, 'organizationId'],
  ['CreateMetricsSourceDto (team)', CreateMetricsSourceDto, { teamId: DEFAULT_ORG }, 'teamId'],
  ['UpdateMetricsSourceDto (organization)', UpdateMetricsSourceDto, { organizationId: DEFAULT_ORG }, 'organizationId'],
  ['UpdateMetricsSourceDto (team)', UpdateMetricsSourceDto, { teamId: DEFAULT_ORG }, 'teamId'],
  ['CreateSystemUnderTestDto (organization)', CreateSystemUnderTestDto, { organizationId: DEFAULT_ORG }, 'organizationId'],
  ['CreateSystemUnderTestDto (team)', CreateSystemUnderTestDto, { teamId: DEFAULT_ORG }, 'teamId'],
];

describe('organization and team ids accept the seeded Default Organization', () => {
  it.each(cases)('%s', (_name, Dto, body, field) => {
    const errors = validateSync(plainToInstance(Dto, body));
    // Other required fields may be missing from the minimal body; only the id field is under test.
    expect(errors.filter((e) => e.property === field)).toEqual([]);
  });

  it.each(cases)('%s still refuses a value that is not a uuid', (_name, Dto, _body, field) => {
    const errors = validateSync(plainToInstance(Dto, { [field]: 'not-a-uuid' }));
    expect(errors.some((e) => e.property === field)).toBe(true);
  });
});
