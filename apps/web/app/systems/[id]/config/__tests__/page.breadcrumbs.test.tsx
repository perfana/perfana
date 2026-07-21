/**
 * Breadcrumb tests for the system configuration page.
 *
 * When opened from a test run (?fromTestRun=<test_run_id>) the breadcrumb offers
 * a way back to that test run; otherwise it leads to the systems list.
 * Rendered via the error state so the heavy config sections stay unmounted.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useSearchParams } from 'next/navigation';
import SystemConfigurationPage from '../page';

jest.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({ hasAnyRole: jest.fn().mockReturnValue(false) }),
}));

jest.mock('@/lib/env', () => ({
  env: { SUT_TRANSFER_ENABLED: false, API_URL: 'http://localhost:3001/api' },
}));

jest.mock('../hooks', () => ({
  useSystemData: jest.fn(() => ({
    loading: false,
    error: 'System not found',
    system: null,
    systemId: 'sys-1',
    selectedEnvironment: '',
    selectedWorkload: '',
    availableEnvironments: [],
    availableWorkloads: [],
    activeTab: 'dashboards',
    hasDynatrace: false,
    hasTracing: false,
    hasPyroscope: false,
    handleEnvironmentChange: jest.fn(),
    handleWorkloadChange: jest.fn(),
    handleTabChange: jest.fn(),
    setSystem: jest.fn(),
    fetchSystem: jest.fn(),
  })),
  useDashboardManagement: jest.fn(() => ({
    fetchApplicationDashboards: jest.fn(),
    clearDashboards: jest.fn(),
  })),
  useSLOManagement: jest.fn(() => ({
    fetchBenchmarks: jest.fn(),
    clearBenchmarks: jest.fn(),
  })),
  useReportingTemplateManagement: jest.fn(() => ({
    fetchTemplates: jest.fn(),
    clearTemplates: jest.fn(),
  })),
}));

const mockUseSearchParams = useSearchParams as jest.Mock;

describe('SystemConfigurationPage breadcrumbs', () => {
  const paramsWith = (params: Record<string, string>) => ({
    get: (key: string) => params[key] ?? null,
  });

  it('shows Systems breadcrumb when not opened from a test run', () => {
    mockUseSearchParams.mockReturnValue(paramsWith({}));

    render(<SystemConfigurationPage />);

    const systemsLink = screen.getByRole('link', { name: 'Systems' });
    expect(systemsLink).toHaveAttribute('href', '/systems');
    expect(screen.queryByRole('link', { name: 'Test Runs' })).not.toBeInTheDocument();
    expect(screen.getByText('Configuration')).toBeInTheDocument();
  });

  it('shows Test Runs > <run id> breadcrumb when opened from a test run', () => {
    mockUseSearchParams.mockReturnValue(paramsWith({ fromTestRun: 'MyTest 1/2' }));

    render(<SystemConfigurationPage />);

    const runsLink = screen.getByRole('link', { name: 'Test Runs' });
    expect(runsLink).toHaveAttribute('href', '/test-runs');

    // Run crumb links back to the originating test run, id URL-encoded
    const runLink = screen.getByRole('link', { name: 'MyTest 1/2' });
    expect(runLink).toHaveAttribute('href', `/test-runs/${encodeURIComponent('MyTest 1/2')}`);

    expect(screen.queryByRole('link', { name: 'Systems' })).not.toBeInTheDocument();
  });
});
