/**
 * Integration Tests for Profile Management Workflow
 *
 * This test suite validates complete user journeys for profile management:
 * - Navigating to profiles page and viewing profile list
 * - Navigating to profile detail page
 * - Viewing profile dashboards and benchmarks
 * - Error handling for various failure scenarios
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { authenticatedFetch } from '@/lib/api';
import { Profile, ProfileDashboard } from '@/lib/profiles';

// Mock dependencies
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => ({
    push: jest.fn(),
    back: jest.fn(),
    refresh: jest.fn(),
  })),
  useParams: jest.fn(() => ({ id: 'profile-123' })),
  useSearchParams: jest.fn(() => ({
    get: jest.fn(),
  })),
}));

jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
  getAuthHeaders: jest.fn(() => ({ Authorization: 'Bearer mock-token' })),
  handleAuthError: jest.fn(),
}));

// Mock organization context (ProfilesPage uses useOrganizationContext)
jest.mock('@/lib/contexts/organization-context', () => ({
  useOrganizationContext: () => ({
    currentOrganizationId: null,
    setCurrentOrganizationId: jest.fn(),
    organizations: [],
    isLoading: false,
    shouldShowSelector: false,
    isSelectorReadOnly: false,
    hasNoOrganizations: false,
    refetch: jest.fn(),
  }),
  OrganizationProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Import page components
import ProfilesPage from '@/app/settings/profiles/page';
import ProfileDetailPage from '@/app/settings/profiles/[id]/page';

describe('Profile Management Workflow Integration', () => {
  const mockProfile: Profile = {
    id: 'profile-123',
    name: 'Load Test Profile',
    description: 'Profile for load testing scenarios',
    tags: ['performance', 'load-test'],
    readOnly: false,
    dashboardCount: 2,
    sloCount: 1,
    deepLinksCount: 0,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  const mockProfiles: Profile[] = [
    mockProfile,
    {
      id: 'profile-456',
      name: 'Smoke Test Profile',
      description: 'Quick smoke test configuration',
      tags: ['smoke-test'],
      readOnly: false,
      dashboardCount: 1,
      sloCount: 0,
      deepLinksCount: 0,
      createdAt: '2024-01-02T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
    },
  ];

  const mockDashboards: ProfileDashboard[] = [
    {
      id: 'dash-1',
      profile: 'profile-123',
      dashboardName: 'JMeter Overview',
      dashboardUid: 'jmeter-overview',
      grafanaLabel: 'grafana-prod',
      tags: ['jmeter', 'performance'],
      createSeparateDashboardForVariable: 'environment',
      setHardcodedValueForVariables: [
        { name: 'region', values: ['us-east-1'] },
      ],
      matchRegexForVariables: {
        workload: '^load-test.*',
      },
      readOnly: false,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
  ];

  const mockGrafanaDashboards = [
    {
      uid: 'jmeter-overview',
      title: 'JMeter Overview',
      tags: ['jmeter', 'performance', 'perfana-template'],
    },
    {
      uid: 'k6-overview',
      title: 'K6 Overview',
      tags: ['k6', 'performance', 'perfana-template'],
    },
  ];

  const mockBenchmarks = [
    {
      id: 'bench-1',
      profile: 'profile-123',
      workload: 'baseline',
      testEnvironment: 'production',
      benchmarkTestRunId: 'TR-2024-001',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup default API responses
    (authenticatedFetch as jest.Mock).mockImplementation((url: string, options?: any) => {
      // Profile endpoints
      if (url.includes('/profiles') && !url.includes('/dashboards') && !url.includes('/benchmarks')) {
        if (options?.method === 'POST') {
          return Promise.resolve({
            ok: true,
            json: async () => ({ ...mockProfile, id: 'new-profile-id' }),
          });
        }
        if (url.includes('profile-123')) {
          return Promise.resolve({
            ok: true,
            json: async () => mockProfile,
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => mockProfiles,
        });
      }

      // Dashboard endpoints
      if (url.includes('/dashboards')) {
        if (options?.method === 'POST') {
          return Promise.resolve({
            ok: true,
            json: async () => ({ ...mockDashboards[0], id: 'new-dash-id' }),
          });
        }
        if (options?.method === 'PUT') {
          return Promise.resolve({
            ok: true,
            json: async () => mockDashboards[0],
          });
        }
        if (options?.method === 'DELETE') {
          return Promise.resolve({
            ok: true,
            json: async () => ({}),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => mockDashboards,
        });
      }

      // Benchmark/SLO endpoints
      if (url.includes('/benchmarks') || url.includes('/slos')) {
        if (options?.method === 'POST') {
          return Promise.resolve({
            ok: true,
            json: async () => ({ ...mockBenchmarks[0], id: 'new-bench-id' }),
          });
        }
        if (options?.method === 'DELETE') {
          return Promise.resolve({
            ok: true,
            json: async () => ({}),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => mockBenchmarks,
        });
      }

      // Grafana dashboards
      if (url.includes('/grafana/dashboards')) {
        return Promise.resolve({
          ok: true,
          json: async () => mockGrafanaDashboards,
        });
      }

      // Grafana instances
      if (url.includes('/grafana-instances')) {
        return Promise.resolve({
          ok: true,
          json: async () => [],
        });
      }

      // Default fallback
      return Promise.resolve({
        ok: true,
        json: async () => [],
      });
    });
  });

  describe('Profiles List Page Workflow', () => {
    it('should load and display profiles list', async () => {
      render(<ProfilesPage />);

      await waitFor(() => {
        expect(screen.getByText('Load Test Profile')).toBeInTheDocument();
        expect(screen.getByText('Smoke Test Profile')).toBeInTheDocument();
      });
    });

    it('should fetch profiles from API on mount', async () => {
      render(<ProfilesPage />);

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('/profiles'),
          expect.objectContaining({ cache: 'no-store' })
        );
      });
    });

    it('should display loading state while fetching profiles', () => {
      (authenticatedFetch as jest.Mock).mockImplementationOnce(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  ok: true,
                  json: async () => mockProfiles,
                }),
              100
            )
          )
      );

      render(<ProfilesPage />);

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('should handle error when profiles fail to load', async () => {
      (authenticatedFetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      render(<ProfilesPage />);

      await waitFor(() => {
        // fetchProfiles throws "Failed to fetch profiles", catch block sets it or fallback "Failed to load profiles"
        expect(screen.getByText(/failed to (fetch|load) profiles/i)).toBeInTheDocument();
      });
    });

    it('should display profile metadata (dashboard count, tags)', async () => {
      render(<ProfilesPage />);

      await waitFor(() => {
        expect(screen.getByText('performance')).toBeInTheDocument();
        expect(screen.getByText('load-test')).toBeInTheDocument();
      });
    });

    it('should navigate to profile detail page when profile is clicked', async () => {
      const mockPush = jest.fn();
      const { useRouter } = require('next/navigation');
      (useRouter as jest.Mock).mockReturnValue({ push: mockPush });

      render(<ProfilesPage />);

      await waitFor(() => {
        const profileRow = screen.getByText('Load Test Profile');
        // Click the row (the profile name or its parent row)
        fireEvent.click(profileRow.closest('tr') || profileRow);
      });

      expect(mockPush).toHaveBeenCalledWith(
        expect.stringContaining('/settings/profiles/profile-123')
      );
    });
  });

  describe('Profile Detail Page Workflow', () => {
    it('should load and display profile details', async () => {
      render(<ProfileDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Load Test Profile')).toBeInTheDocument();
      });
    });

    it('should display profile description', async () => {
      render(<ProfileDetailPage />);

      await waitFor(() => {
        expect(screen.getByText(/Profile for load testing scenarios/i)).toBeInTheDocument();
      });
    });

    it('should load profile dashboards', async () => {
      render(<ProfileDetailPage />);

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('/profiles/profile-123/dashboards'),
          expect.objectContaining({ cache: 'no-store' })
        );
      });
    });

    it('should display dashboards in the Dashboards tab', async () => {
      render(<ProfileDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('JMeter Overview')).toBeInTheDocument();
      });
    });

    it('should display profile tabs', async () => {
      render(<ProfileDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Dashboards')).toBeInTheDocument();
        expect(screen.getByText('Service Level Objectives')).toBeInTheDocument();
        expect(screen.getByText('Deep Links')).toBeInTheDocument();
      });
    });

    it('should display Add Dashboard button', async () => {
      render(<ProfileDetailPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /add dashboard/i })).toBeInTheDocument();
      });
    });

    it('should display back navigation button', async () => {
      render(<ProfileDetailPage />);

      await waitFor(() => {
        expect(screen.getByText(/back to profiles/i)).toBeInTheDocument();
      });
    });

    it('should navigate back when back button is clicked', async () => {
      const mockPush = jest.fn();
      const { useRouter } = require('next/navigation');
      (useRouter as jest.Mock).mockReturnValue({ push: mockPush, back: jest.fn(), refresh: jest.fn() });

      render(<ProfileDetailPage />);

      await waitFor(() => {
        const backButton = screen.getByText(/back to profiles/i);
        fireEvent.click(backButton);
      });

      expect(mockPush).toHaveBeenCalledWith('/settings/profiles');
    });
  });

  describe('Dashboard Tab Interaction', () => {
    it('should open add dashboard dialog when Add Dashboard button is clicked', async () => {
      render(<ProfileDetailPage />);

      await waitFor(() => {
        const addButton = screen.getByRole('button', { name: /add dashboard/i });
        fireEvent.click(addButton);
      });

      await waitFor(() => {
        // The dialog title is "Add Dashboard to Profile"
        expect(screen.getByText(/add dashboard to profile/i)).toBeInTheDocument();
      });
    });

    it('should load Grafana data when add dashboard dialog opens', async () => {
      render(<ProfileDetailPage />);

      await waitFor(() => {
        const addButton = screen.getByRole('button', { name: /add dashboard/i });
        fireEvent.click(addButton);
      });

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('/grafana'),
          expect.anything()
        );
      });
    });
  });

  describe('Service Level Objectives Tab', () => {
    it('should switch to Service Level Objectives tab', async () => {
      render(<ProfileDetailPage />);

      await waitFor(() => {
        const sloTab = screen.getByText('Service Level Objectives');
        fireEvent.click(sloTab);
      });

      await waitFor(() => {
        // The button label is "Add Service Level Objective"
        expect(screen.getByRole('button', { name: /add service level objective/i })).toBeInTheDocument();
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle network error gracefully on profiles page', async () => {
      (authenticatedFetch as jest.Mock).mockRejectedValueOnce(
        new Error('Network error')
      );

      render(<ProfilesPage />);

      await waitFor(() => {
        // The catch block shows either the error message or fallback
        expect(screen.getByText(/network error|failed to (load|fetch)/i)).toBeInTheDocument();
      });
    });

    it('should display error state on profile detail page when profile not found', async () => {
      (authenticatedFetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/profiles/profile-123') && !url.includes('/dashboards') && !url.includes('/benchmarks')) {
          return Promise.resolve({
            ok: false,
            status: 404,
            json: async () => ({ message: 'Profile not found' }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => [],
        });
      });

      render(<ProfileDetailPage />);

      await waitFor(() => {
        // Should show error or "not found" message
        expect(screen.getByText(/not found|error|failed/i)).toBeInTheDocument();
      });
    });
  });
});
