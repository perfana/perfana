/**
 * Tests for the "Open in Dynatrace" deep link on the host properties panel.
 *
 * This section used to build the platform host with a chain of string
 * `.replace()` calls, which rewrote *any* base URL into
 * `<whatever>.apps.dynatrace.com`. With a proxy `clientUrl` that produced
 * `dt-proxy.internal.example.com.apps.dynatrace.com` — a host that does not
 * exist — and it rewrote managed clusters, which have no platform host at all.
 * It now shares `deepLinkBaseUrl` / `createPlatformUrl` with the other deep
 * links, so these tests pin the three shapes apart.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import HostPropertiesSection from './HostPropertiesSection';
import type { DynatraceConfig, HostPropertiesResponse } from '@/lib/dynatrace';

const PROPERTIES: HostPropertiesResponse = {
  entityId: 'HOST-ABC123',
  displayName: 'web-1',
  properties: {
    cpuCores: 8,
    osType: 'LINUX',
    osArchitecture: 'X86',
    bitness: '64bit',
    monitoringMode: 'FULL_STACK',
    hostName: 'web-1',
    ipAddresses: ['10.0.0.1'],
    cloudType: 'AWS',
    memoryTotal: 17179869184,
  },
  lastSeenTimestamp: 1753178400000,
};

const START_TIME = '2026-07-22T10:00:00Z';
const END_TIME = '2026-07-22T10:30:00Z';
const EXPECTED_TIME_FILTER = `gtf=c_${new Date(START_TIME).getTime()}_${new Date(END_TIME).getTime()}`;

function makeConfig(overrides: Partial<DynatraceConfig> = {}): DynatraceConfig {
  return {
    id: 'cfg-1',
    label: 'Prod tenant',
    host: 'https://abc12345.live.dynatrace.com',
    apiToken: 'stored-token',
    dynatraceType: 'saas',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

/**
 * Render the panel, click "Open in Dynatrace", unmount, and return the URL from
 * the most recent window.open call. Unmounting keeps repeated calls inside one
 * test from leaving several identical buttons in the document.
 */
function openedUrl(config: DynatraceConfig): string {
  const { unmount } = render(
    <HostPropertiesSection
      properties={PROPERTIES}
      hostId="HOST-ABC123"
      config={config}
      startTime={START_TIME}
      endTime={END_TIME}
    />
  );

  fireEvent.click(screen.getByRole('button', { name: /open in dynatrace/i }));
  unmount();

  const calls = (window.open as jest.Mock).mock.calls;
  return calls[calls.length - 1][0] as string;
}

describe('HostPropertiesSection — Open in Dynatrace', () => {
  beforeEach(() => {
    window.open = jest.fn();
  });

  it('rewrites a SaaS tenant host to its platform (apps) host', () => {
    const url = openedUrl(makeConfig());

    expect(url).toBe(
      `https://abc12345.apps.dynatrace.com/ui/apps/dynatrace.classic.hosts/ui/entity/HOST-ABC123?${EXPECTED_TIME_FILTER}&gf=all`
    );
  });

  // The browser may only be able to reach Dynatrace through a proxy. That
  // address is already the one to open — appending `.apps.dynatrace.com` to it
  // produced a hostname that resolves nowhere.
  it('leaves a SaaS proxy clientUrl on the proxy host', () => {
    const url = openedUrl(
      makeConfig({ clientUrl: 'https://dt-proxy.internal.example.com/' })
    );

    expect(url).toBe(
      `https://dt-proxy.internal.example.com/ui/apps/dynatrace.classic.hosts/ui/entity/HOST-ABC123?${EXPECTED_TIME_FILTER}&gf=all`
    );
    expect(url).not.toContain('.apps.dynatrace.com');
  });

  it('uses a managed cluster URL unchanged — managed has no platform host', () => {
    const url = openedUrl(
      makeConfig({ host: 'https://dynatrace.managed.example.com', dynatraceType: 'managed' })
    );

    expect(url).toBe(
      `https://dynatrace.managed.example.com/ui/apps/dynatrace.classic.hosts/ui/entity/HOST-ABC123?${EXPECTED_TIME_FILTER}&gf=all`
    );
  });

  it('falls back to a relative time filter when the test run has no window', () => {
    render(
      <HostPropertiesSection properties={PROPERTIES} hostId="HOST-ABC123" config={makeConfig()} />
    );

    fireEvent.click(screen.getByRole('button', { name: /open in dynatrace/i }));

    expect((window.open as jest.Mock).mock.calls[0][0]).toContain('?gtf=-2h&gf=all');
  });

  it('opens every deep link with noopener,noreferrer', () => {
    const configs = [
      makeConfig(),
      makeConfig({ clientUrl: 'https://dt-proxy.internal.example.com' }),
      makeConfig({ host: 'https://dynatrace.managed.example.com', dynatraceType: 'managed' }),
    ];

    configs.forEach((config) => openedUrl(config));

    const calls = (window.open as jest.Mock).mock.calls;
    expect(calls).toHaveLength(3);
    calls.forEach(([, target, features]) => {
      expect(target).toBe('_blank');
      expect(features).toBe('noopener,noreferrer');
    });
  });
});
