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

  it('rejects an organizationId that is not a uuid', async () => {
    const errors = await validate(plainToClass(CreateProfileDto, { name: 'jvm', organizationId: 'org-a' }));
    expect(errors).toHaveLength(1);
    expect(errors[0]!.property).toBe('organizationId');
  });
});
