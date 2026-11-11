import { validate } from 'class-validator';
import { plainToClass } from 'class-transformer';
import { CreateProfileDto } from './profile.dto';

/**
 * `organizationId` is optional (omitted, the service picks one of the caller's own), and a
 * malformed one must be refused here: the service compares it against the caller's memberships
 * and, for a global admin, looks it up as a uuid.
 */
describe('CreateProfileDto', () => {
  it('accepts a profile with no organizationId', async () => {
    const errors = await validate(plainToClass(CreateProfileDto, { name: 'jvm' }));
    expect(errors).toHaveLength(0);
  });

  it('accepts a uuid organizationId', async () => {
    const errors = await validate(
      plainToClass(CreateProfileDto, { name: 'jvm', organizationId: '7f0c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f' }),
    );
    expect(errors).toHaveLength(0);
  });

  /**
   * Value: protects=profile creation in the seeded Default Organization, which the web sends when it is selected;
   *   fails_when=organizationId is validated as a strict RFC uuid, which 00000000-...-000000000001 is not;
   *   why_new=the case above uses a v4 id; seam=none; no_claim=the service's membership check.
   */
  it('accepts the seeded Default Organization id, which is not a strict RFC uuid', async () => {
    const errors = await validate(
      plainToClass(CreateProfileDto, { name: 'jvm', organizationId: '00000000-0000-0000-0000-000000000001' }),
    );
    expect(errors).toHaveLength(0);
  });

  it('rejects an organizationId that is not a uuid', async () => {
    const errors = await validate(plainToClass(CreateProfileDto, { name: 'jvm', organizationId: 'org-a' }));
    expect(errors).toHaveLength(1);
    expect(errors[0]!.property).toBe('organizationId');
  });
});
