/**
 * DashboardManager unit tests.
 *
 * Focused on the RBAC ownership wiring added for issue #275:
 * `application_dashboards.organization_id` is NOT NULL since migration
 * `1777700000000-OrganizationIdNotNull`, so `createScenarioDashboard` must
 * resolve org/team from the parent SUT and thread them through both the
 * `application_dashboards` INSERT and the `metrics_sources` upsert.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DashboardManager } from '../../../pipelines/helpers/dashboard-manager.js';

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
};

const SUT_ID = '11111111-1111-1111-1111-111111111111';
const ORG_ID = '00000000-0000-0000-0000-000000000001';
const TEAM_ID = '22222222-2222-2222-2222-222222222222';

const sutOwnershipRow = (overrides: Partial<{ organization_id: string | null; team_id: string | null }> = {}) => [
  { organization_id: ORG_ID, team_id: null, ...overrides },
];

describe('DashboardManager.getOrCreateScenarioDashboard', () => {
  let mockDataSource: { query: ReturnType<typeof vi.fn> };
  let manager: DashboardManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDataSource = { query: vi.fn() };
    manager = new DashboardManager(mockDataSource as any, mockLogger as any);
  });

  it('threads organization_id from systems_under_test into application_dashboards INSERT', async () => {
    mockDataSource.query
      .mockResolvedValueOnce(sutOwnershipRow({ team_id: TEAM_ID })) // SELECT systems_under_test
      .mockResolvedValueOnce([]) // SELECT id FROM application_dashboards
      .mockResolvedValueOnce([]) // INSERT INTO application_dashboards
      .mockResolvedValueOnce([{ id: 'metrics-source-uuid-1' }]); // INSERT INTO metrics_sources

    const metadata = await manager.getOrCreateScenarioDashboard('checkout', SUT_ID, 'production');

    expect(metadata.dashboardUid).toMatch(/^performance-test-metrics-/);
    expect(metadata.metricsSourceId).toBe('metrics-source-uuid-1');

    // Call 1: SUT lookup
    const sutCall = mockDataSource.query.mock.calls[0];
    expect(sutCall[0]).toMatch(/SELECT organization_id, team_id FROM systems_under_test/);
    expect(sutCall[1]).toEqual([SUT_ID]);

    // Call 3: application_dashboards INSERT — must include organization_id
    const appDashCall = mockDataSource.query.mock.calls[2];
    expect(appDashCall[0]).toMatch(/INSERT INTO application_dashboards/);
    expect(appDashCall[0]).toMatch(/organization_id/);
    expect(appDashCall[1]).toContain(ORG_ID);
    expect(appDashCall[1]).toContain(TEAM_ID);
    expect(appDashCall[1]).toContain('worker-pipeline');

    // Call 4: metrics_sources upsert — must include organization_id
    const msCall = mockDataSource.query.mock.calls[3];
    expect(msCall[0]).toMatch(/INSERT INTO metrics_sources/);
    expect(msCall[0]).toMatch(/organization_id/);
    expect(msCall[1]).toContain(ORG_ID);
    expect(msCall[1]).toContain(TEAM_ID);
  });

  it('caches SUT ownership across calls for the same systemUnderTestId', async () => {
    mockDataSource.query
      // First call sequence
      .mockResolvedValueOnce(sutOwnershipRow())
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'ms-1' }])
      // Second call sequence — different scenario, same SUT — should NOT re-query SUT.
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'ms-2' }]);

    await manager.getOrCreateScenarioDashboard('checkout', SUT_ID, 'production');
    await manager.getOrCreateScenarioDashboard('login', SUT_ID, 'production');

    const sutSelectCalls = mockDataSource.query.mock.calls.filter((c: any[]) =>
      String(c[0]).includes('FROM systems_under_test')
    );
    expect(sutSelectCalls.length).toBe(1);
  });

  it('returns the cached dashboard on a repeat call without further queries', async () => {
    mockDataSource.query
      .mockResolvedValueOnce(sutOwnershipRow())
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'ms-1' }]);

    const first = await manager.getOrCreateScenarioDashboard('checkout', SUT_ID, 'production');
    const second = await manager.getOrCreateScenarioDashboard('checkout', SUT_ID, 'production');

    expect(second).toBe(first);
    expect(mockDataSource.query).toHaveBeenCalledTimes(4);
  });

  it('throws a descriptive error when the SUT row is missing', async () => {
    mockDataSource.query.mockResolvedValueOnce([]); // SELECT systems_under_test → no rows

    await expect(
      manager.getOrCreateScenarioDashboard('checkout', SUT_ID, 'production')
    ).rejects.toThrow(/SUT not found/);
  });

  it('throws when SUT exists but has no organization_id', async () => {
    mockDataSource.query.mockResolvedValueOnce(sutOwnershipRow({ organization_id: null }));

    await expect(
      manager.getOrCreateScenarioDashboard('checkout', SUT_ID, 'production')
    ).rejects.toThrow(/has no organization_id/);
  });

  it('does not refresh created_by on metrics_sources DO UPDATE (preserves original creator)', async () => {
    mockDataSource.query
      .mockResolvedValueOnce(sutOwnershipRow())
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'ms-1' }]);

    await manager.getOrCreateScenarioDashboard('checkout', SUT_ID, 'production');

    const msCall = mockDataSource.query.mock.calls[3];
    const sql = String(msCall[0]).replace(/\s+/g, ' ');
    expect(sql).toMatch(/DO UPDATE SET/);
    expect(sql).not.toMatch(/created_by\s*=\s*EXCLUDED\.created_by/);
  });
});
