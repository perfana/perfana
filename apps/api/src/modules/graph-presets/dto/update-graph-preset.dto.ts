import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateGraphPresetDto } from './create-graph-preset.dto';

/**
 * Every field of a create, all optional — except `testRunId`.
 *
 * A preset's owning system is derived from the test run it was saved from, so letting
 * an update move it to another run would silently move the preset to another system
 * (and leave `organization_id` pointing at the old one). Re-scoping is a delete and a
 * re-save. `isGlobal` stays editable: it only widens the preset from that one run to
 * every run of the same system and environment.
 */
export class UpdateGraphPresetDto extends PartialType(
  OmitType(CreateGraphPresetDto, ['testRunId'] as const),
) {}
