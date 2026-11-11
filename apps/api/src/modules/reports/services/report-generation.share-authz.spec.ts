import { ForbiddenException } from '@nestjs/common';
import { Capability } from '../../../constants/capabilities.constants';
import { ResourceNotFoundException } from '../../../common/exceptions/business.exception';
import { ReportGenerationService } from './report-generation.service';

/**
 * Sharing is off by default, so this check is what stands between a report and the public link.
 */
describe('ReportGenerationService.assertCanChangeSharing', () => {
  const report = { id: 'r1', test_run: { organizationId: 'org-1', teamId: 'team-1' } };

  function setup({ findById = jest.fn().mockResolvedValue(report), caps = [] as string[] } = {}) {
    const getCapabilities = jest.fn().mockResolvedValue(caps);
    const service = Object.create(ReportGenerationService.prototype) as ReportGenerationService;
    Object.assign(service, {
      findById,
      authzService: { getCapabilities },
      logger: { warn: jest.fn() },
    });
    return { service, getCapabilities, findById };
  }

  it('allows a caller holding test-run:update on the report\'s own run', async () => {
    const { service, getCapabilities } = setup({ caps: [Capability.TestRunUpdate] });

    await expect(service.assertCanChangeSharing('r1', 'user-1', ['user'])).resolves.toBeUndefined();

    expect(getCapabilities).toHaveBeenCalledWith('user-1', ['user'], 'org-1', 'team-1');
  });

  it('refuses a caller who can read the report but not write, such as an org viewer', async () => {
    const { service } = setup({ caps: ['test-run:read'] });

    await expect(service.assertCanChangeSharing('r1', 'viewer', ['user'])).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('answers a report the caller cannot see with a 404, so existence stays unlearnable', async () => {
    const notFound = new ResourceNotFoundException('Report', 'r1');
    const { service, getCapabilities, findById } = setup({ findById: jest.fn().mockRejectedValue(notFound) });

    await expect(service.assertCanChangeSharing('r1', 'other-tenant', ['user'])).rejects.toBe(notFound);

    expect(findById).toHaveBeenCalledWith('r1', 'other-tenant', ['user']);
    expect(getCapabilities).not.toHaveBeenCalled();
  });

  it('exempts an API key that can see the report, since a key has no membership to hold a capability', async () => {
    const { service, getCapabilities } = setup();

    await expect(service.assertCanChangeSharing('r1', 'api-key:k1', [])).resolves.toBeUndefined();

    expect(getCapabilities).not.toHaveBeenCalled();
  });

  it('still refuses an API key that cannot see the report', async () => {
    const notFound = new ResourceNotFoundException('Report', 'r1');
    const { service } = setup({ findById: jest.fn().mockRejectedValue(notFound) });

    await expect(service.assertCanChangeSharing('r1', 'api-key:k1', [])).rejects.toBe(notFound);
  });
});
