/**
 * Unit tests for grafana-config-cache.
 *
 * Covers the soft-skip vs hard-fail distinction added in issue #282:
 * - tryGetGrafanaConfig() returns null when zero rows in grafana_instances
 * - tryGetGrafanaConfig() throws when a row exists but is invalid
 * - getGrafanaConfig() always throws when no valid config (legacy callers)
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../common/database-accessor.js');

import * as databaseAccessor from '../../../common/database-accessor.js';
import {
  getGrafanaConfig,
  tryGetGrafanaConfig,
  getGrafanaConfigById,
  initializeGrafanaConfig,
  clearGrafanaConfigCache,
} from '../../../config/grafana-config-cache.js';

describe('grafana-config-cache', () => {
  let findMock: ReturnType<typeof vi.fn>;
  let findOneMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearGrafanaConfigCache();
    findMock = vi.fn();
    findOneMock = vi.fn();
    vi.mocked(databaseAccessor.getDatabaseService).mockReturnValue({
      grafanaInstanceRepo: { find: findMock, findOne: findOneMock },
    } as any);
  });

  describe('tryGetGrafanaConfig', () => {
    test('returns null when grafana_instances is empty', async () => {
      findMock.mockResolvedValue([]);

      const result = await tryGetGrafanaConfig();

      expect(result).toBeNull();
      expect(findMock).toHaveBeenCalledTimes(1);
    });

    test('returns the config when a valid row exists', async () => {
      findMock.mockResolvedValue([
        {
          id: 'inst-1',
          server_url: 'https://grafana.example',
          apiKey: 'secret',
          orgId: '1',
        },
      ]);

      const result = await tryGetGrafanaConfig();

      expect(result).toEqual({
        url: 'https://grafana.example',
        apiKey: 'secret',
        orgId: '1',
      });
    });

    test('throws when a row exists but server_url is missing', async () => {
      findMock.mockResolvedValue([
        { id: 'inst-1', server_url: '', apiKey: 'secret', orgId: '1' },
      ]);

      await expect(tryGetGrafanaConfig()).rejects.toThrow(/invalid/i);
    });

    test('throws when a row exists but apiKey is missing', async () => {
      findMock.mockResolvedValue([
        { id: 'inst-1', server_url: 'https://grafana.example', apiKey: '', orgId: '1' },
      ]);

      await expect(tryGetGrafanaConfig()).rejects.toThrow(/invalid/i);
    });

    test('throws when the database query fails', async () => {
      findMock.mockRejectedValue(new Error('connection refused'));

      await expect(tryGetGrafanaConfig()).rejects.toThrow();
    });

    test('caches the loaded config across calls', async () => {
      findMock.mockResolvedValue([
        {
          id: 'inst-1',
          server_url: 'https://grafana.example',
          apiKey: 'secret',
          orgId: '1',
        },
      ]);

      await tryGetGrafanaConfig();
      await tryGetGrafanaConfig();

      expect(findMock).toHaveBeenCalledTimes(1);
    });

    test('singleflights concurrent calls when not yet cached', async () => {
      findMock.mockResolvedValue([]);

      await Promise.all([tryGetGrafanaConfig(), tryGetGrafanaConfig(), tryGetGrafanaConfig()]);

      expect(findMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('getGrafanaConfig', () => {
    test('throws "not available" when no row exists', async () => {
      findMock.mockResolvedValue([]);

      await expect(getGrafanaConfig()).rejects.toThrow(/not available/i);
    });

    test('throws when a row exists but is invalid', async () => {
      findMock.mockResolvedValue([
        { id: 'inst-1', server_url: 'https://grafana.example', apiKey: '', orgId: '1' },
      ]);

      await expect(getGrafanaConfig()).rejects.toThrow();
    });

    test('returns the cached config on success', async () => {
      findMock.mockResolvedValue([
        {
          id: 'inst-1',
          server_url: 'https://grafana.example',
          apiKey: 'secret',
          orgId: '1',
        },
      ]);

      const result = await getGrafanaConfig();

      expect(result).toEqual({
        url: 'https://grafana.example',
        apiKey: 'secret',
        orgId: '1',
      });
    });
  });

  describe('getGrafanaConfigById', () => {
    test('resolves the requested instance — not the first row', async () => {
      // The singleton path would return the oldest row; by-id must return exactly inst-2.
      findOneMock.mockResolvedValue({
        id: 'inst-2',
        server_url: 'https://grafana-2.example',
        apiKey: 'secret-2',
        orgId: '7',
        organizationId: 'org-2',
        useProxy: true,
      });

      const result = await getGrafanaConfigById('inst-2');

      expect(findOneMock).toHaveBeenCalledWith({ where: { id: 'inst-2' } });
      expect(result).toEqual({
        config: { url: 'https://grafana-2.example', apiKey: 'secret-2', orgId: '7' },
        meta: { organizationId: 'org-2', useProxy: true },
      });
    });

    test('caches per id (one DB hit per instance)', async () => {
      findOneMock.mockResolvedValue({
        id: 'inst-2', server_url: 'https://g2', apiKey: 'k', orgId: '1',
      });

      await getGrafanaConfigById('inst-2');
      await getGrafanaConfigById('inst-2');

      expect(findOneMock).toHaveBeenCalledTimes(1);
    });

    test('returns null (and caches the miss) when the instance is missing', async () => {
      findOneMock.mockResolvedValue(null);

      expect(await getGrafanaConfigById('nope')).toBeNull();
      expect(await getGrafanaConfigById('nope')).toBeNull();
      expect(findOneMock).toHaveBeenCalledTimes(1); // negative result cached
    });

    test('returns null when the row is missing required fields', async () => {
      findOneMock.mockResolvedValue({ id: 'inst-2', server_url: '', apiKey: '', orgId: '1' });

      expect(await getGrafanaConfigById('inst-2')).toBeNull();
    });

    test('returns null without poisoning the cache on a DB error', async () => {
      findOneMock.mockRejectedValueOnce(new Error('connection refused'));
      expect(await getGrafanaConfigById('inst-2')).toBeNull();

      // A later call retries (transient error was not cached).
      findOneMock.mockResolvedValue({ id: 'inst-2', server_url: 'https://g2', apiKey: 'k', orgId: '1' });
      expect(await getGrafanaConfigById('inst-2')).not.toBeNull();
    });
  });

  describe('initializeGrafanaConfig', () => {
    test('does not throw when no instance is configured', async () => {
      findMock.mockResolvedValue([]);

      await expect(initializeGrafanaConfig()).resolves.toBeUndefined();
    });

    test('does not throw when an invalid row exists', async () => {
      findMock.mockResolvedValue([
        { id: 'inst-1', server_url: '', apiKey: '', orgId: '1' },
      ]);

      await expect(initializeGrafanaConfig()).resolves.toBeUndefined();
    });
  });
});
