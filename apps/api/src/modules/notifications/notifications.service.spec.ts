import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { NotificationChannel } from '@perfana/shared';
import { NotificationsService } from './notifications.service';
import { MASKED_WEBHOOK_URL } from './notifications.constants';
import { ResourceNotFoundException } from '../../common/exceptions/business.exception';

/**
 * Tenant scoping for notification channels. Until these checks existed any
 * authenticated user could read another organization's webhook URL (a bearer
 * credential for its Slack/Teams channel), edit or delete the channel, or post into
 * it through the test send.
 */
jest.mock('../../common/db/request-em', () => {
  const actual = jest.requireActual('../../common/db/request-em');
  return { ...actual, withRequestEm: jest.fn((repo: unknown) => repo) };
});

const ORG = '00000000-0000-0000-0000-0000000000a1';
const OTHER_ORG = '00000000-0000-0000-0000-0000000000b2';
const SUT = '00000000-0000-0000-0000-00000000005a';
const OTHER_SUT = '00000000-0000-0000-0000-00000000005b';
const CHANNEL = '11111111-1111-1111-1111-111111111111';
const OTHER_CHANNEL = '22222222-2222-2222-2222-222222222222';
const URL = 'https://hooks.slack.com/services/T000/B000/secret';
const USER = 'user-1';

const channel = (overrides: Partial<NotificationChannel> = {}): NotificationChannel =>
  Object.assign(new NotificationChannel(), {
    id: CHANNEL,
    systemUnderTestId: SUT,
    type: 'slack',
    name: '#perf',
    webhookUrl: URL,
    notifyOnFinished: true,
    notifyOnFailedOnly: false,
    enabled: true,
    useProxy: false,
    organizationId: ORG,
    teamId: undefined,
    ...overrides,
  });

describe('NotificationsService tenant scoping', () => {
  let service: NotificationsService;
  let channelRepo: any;
  let sutRepo: any;
  let authz: { isGlobalAdmin: jest.Mock; getAccessibleOrganizations: jest.Mock; getCapabilities: jest.Mock };
  let proxyResolver: { resolve: jest.Mock };
  let fetchMock: jest.Mock;

  beforeEach(() => {
    const rows = [channel(), channel({ id: OTHER_CHANNEL, systemUnderTestId: OTHER_SUT, organizationId: OTHER_ORG })];
    channelRepo = {
      findOne: jest.fn(async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null),
      find: jest.fn(async () => [rows[0]]),
      create: jest.fn((fields: Partial<NotificationChannel>) => Object.assign(new NotificationChannel(), fields)),
      save: jest.fn(async (c: NotificationChannel) => Object.assign(c, { id: c.id ?? 'new-id' })),
      remove: jest.fn(async (c: NotificationChannel) => c),
    };
    sutRepo = {
      findOne: jest.fn(async ({ where }: any) => {
        if (where.id === SUT) return { id: SUT, name: 'shop', organization_id: ORG, team_id: null };
        if (where.id === OTHER_SUT) return { id: OTHER_SUT, name: 'bank', organization_id: OTHER_ORG, team_id: null };
        return null;
      }),
    };
    authz = {
      isGlobalAdmin: jest.fn(() => false),
      getAccessibleOrganizations: jest.fn(async () => [ORG]),
      getCapabilities: jest.fn(async () => ['sut:manage']),
    };
    proxyResolver = { resolve: jest.fn(async () => undefined) };
    const config = { get: jest.fn(() => undefined) };
    service = new NotificationsService(channelRepo, sutRepo, config as any, proxyResolver as any, authz as any);

    fetchMock = jest.fn(async () => ({ ok: true, text: async () => '' }));
    (global as any).fetch = fetchMock;
  });

  describe('reads', () => {
    it('lists only channels in the caller\'s organizations and masks the webhook URL', async () => {
      const result = await service.findBySystemId(SUT, USER, []);

      const where = channelRepo.find.mock.calls[0][0].where;
      expect(where.systemUnderTestId).toBe(SUT);
      expect(where.organizationId.value).toEqual([ORG]);
      expect(result).toHaveLength(1);
      expect(result[0].webhookUrl).toBe(MASKED_WEBHOOK_URL);
    });

    it('returns [] without querying when the caller has no organizations', async () => {
      authz.getAccessibleOrganizations.mockResolvedValue([]);

      await expect(service.findBySystemId(SUT, USER, [])).resolves.toEqual([]);
      expect(channelRepo.find).not.toHaveBeenCalled();
    });

    it('does not filter by organization for a global admin', async () => {
      authz.isGlobalAdmin.mockReturnValue(true);

      await service.findBySystemId(SUT, USER, ['perfana-admin']);

      expect(channelRepo.find.mock.calls[0][0].where.organizationId).toBeUndefined();
    });

    it('answers 404, not 403, for another organization\'s channel by id', async () => {
      await expect(service.findOne(OTHER_CHANNEL, USER, [])).rejects.toBeInstanceOf(ResourceNotFoundException);
    });

    it('masks the webhook URL on a read by id', async () => {
      const result = await service.findOne(CHANNEL, USER, []);

      expect(result.webhookUrl).toBe(MASKED_WEBHOOK_URL);
    });
  });

  describe('create', () => {
    const dto = { systemUnderTestId: SUT, type: 'slack' as const, name: '#perf', webhookUrl: URL };

    it('refuses another organization\'s system with the same message as a missing one', async () => {
      const err = await service.create({ ...dto, systemUnderTestId: OTHER_SUT }, USER, []).catch((e) => e);

      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toBe(`System under test not found: ${OTHER_SUT}`);
      expect(channelRepo.save).not.toHaveBeenCalled();
    });

    it('refuses a caller without sut:manage (org viewer)', async () => {
      authz.getCapabilities.mockResolvedValue(['test-run:read']);

      await expect(service.create(dto, USER, [])).rejects.toBeInstanceOf(ForbiddenException);
      expect(channelRepo.save).not.toHaveBeenCalled();
    });

    it('inherits the system\'s organization and returns a masked URL', async () => {
      const result = await service.create(dto, USER, []);

      expect(channelRepo.create.mock.calls[0][0].organizationId).toBe(ORG);
      expect(channelRepo.save.mock.calls[0][0].webhookUrl).toBe(URL);
      expect(result.webhookUrl).toBe(MASKED_WEBHOOK_URL);
    });

    it('lets an API key in the system\'s organization create without a role', async () => {
      await service.create(dto, 'api-key:abc', []);

      expect(authz.getCapabilities).not.toHaveBeenCalled();
      expect(channelRepo.save).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('answers 404 for another organization\'s channel and writes nothing', async () => {
      await expect(service.update(OTHER_CHANNEL, { name: 'x' }, USER, [])).rejects.toBeInstanceOf(
        ResourceNotFoundException,
      );
      expect(channelRepo.save).not.toHaveBeenCalled();
    });

    it('refuses a caller without sut:manage', async () => {
      authz.getCapabilities.mockResolvedValue([]);

      await expect(service.update(CHANNEL, { name: 'x' }, USER, [])).rejects.toBeInstanceOf(ForbiddenException);
      expect(channelRepo.save).not.toHaveBeenCalled();
    });

    it('keeps the stored URL when the masked placeholder is sent back', async () => {
      await service.update(CHANNEL, { name: 'renamed', webhookUrl: MASKED_WEBHOOK_URL }, USER, []);

      const saved = channelRepo.save.mock.calls[0][0];
      expect(saved.webhookUrl).toBe(URL);
      expect(saved.name).toBe('renamed');
    });

    it('ignores an explicit null webhook URL instead of writing NULL', async () => {
      await service.update(CHANNEL, { webhookUrl: null as unknown as string }, USER, []);

      expect(channelRepo.save.mock.calls[0][0].webhookUrl).toBe(URL);
    });

    it('replaces the URL when a new one is sent', async () => {
      const next = 'https://hooks.slack.com/services/T000/B000/rotated';

      const result = await service.update(CHANNEL, { webhookUrl: next }, USER, []);

      expect(channelRepo.save.mock.calls[0][0].webhookUrl).toBe(next);
      expect(result.webhookUrl).toBe(MASKED_WEBHOOK_URL);
    });
  });

  describe('delete', () => {
    it('answers 404 for another organization\'s channel', async () => {
      await expect(service.delete(OTHER_CHANNEL, USER, [])).rejects.toBeInstanceOf(ResourceNotFoundException);
      expect(channelRepo.remove).not.toHaveBeenCalled();
    });

    it('refuses a caller without sut:manage', async () => {
      authz.getCapabilities.mockResolvedValue([]);

      await expect(service.delete(CHANNEL, USER, [])).rejects.toBeInstanceOf(ForbiddenException);
      expect(channelRepo.remove).not.toHaveBeenCalled();
    });
  });

  describe('testChannel', () => {
    it('answers 404 for another organization\'s channel and posts nothing', async () => {
      await expect(service.testChannel(OTHER_CHANNEL, USER, [])).rejects.toBeInstanceOf(ResourceNotFoundException);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refuses a caller without sut:manage, since it posts into the channel', async () => {
      authz.getCapabilities.mockResolvedValue(['test-run:read']);

      await expect(service.testChannel(CHANNEL, USER, [])).rejects.toBeInstanceOf(ForbiddenException);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('posts to the stored (unmasked) URL for an authorized caller', async () => {
      const result = await service.testChannel(CHANNEL, USER, []);

      expect(result.success).toBe(true);
      expect(fetchMock.mock.calls[0][0]).toBe(URL);
    });
  });
});
