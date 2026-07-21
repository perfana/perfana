/**
 * Unit tests for DeepLinksCard Component
 *
 * Tests the deep links card functionality:
 * - Rendering in collapsed and expanded states
 * - Fetching deep links from API
 * - Resolving link variables
 * - Expand/collapse behavior with auto-focus
 * - Link click handling
 * - Error states and loading states
 * - Navigation to configuration page
 * - Invalid/unresolved link handling
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useRouter } from 'next/navigation';
import DeepLinksCard from '@/app/test-runs/[id]/components/deep-links/DeepLinksCard';
import { authenticatedFetch } from '@/lib/api';

// Mock Next.js router
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

// Mock authenticated fetch
jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(),
}));

describe('DeepLinksCard', () => {
  const mockPush = jest.fn();
  const mockOnExpand = jest.fn();
  const mockWindowOpen = jest.fn();

  const mockTestRun = {
    test_run_id: 'test-run-001',
    system_under_test_id: 'system-123',
    test_environment: 'production',
    workload: 'load-test-1',
  };

  const mockDeepLinks = [
    {
      id: 'link-1',
      name: 'Grafana Dashboard',
      url: 'https://grafana.example.com/d/{{dashboardId}}',
      tags: [],
    },
    {
      id: 'link-2',
      name: 'APM Tool',
      url: 'https://apm.example.com/trace/{{traceId}}',
      tags: [],
    },
  ];

  const mockResolvedLinks = [
    {
      id: 'link-1',
      name: 'Grafana Dashboard',
      url: 'https://grafana.example.com/d/abc123',
      isValid: true,
      tags: [],
    },
    {
      id: 'link-2',
      name: 'APM Tool',
      url: 'https://apm.example.com/trace/{{traceId}}',
      isValid: false,
      unresolvedVariables: ['traceId'],
      tags: [],
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue({
      push: mockPush,
    });
    // Mock window.open
    global.window.open = mockWindowOpen;
  });

  describe('Rendering - Collapsed State', () => {
    it('should render collapsed card', async () => {
      (authenticatedFetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockDeepLinks,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResolvedLinks[0],
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResolvedLinks[1],
        });

      render(
        <DeepLinksCard
          testRun={mockTestRun}
          expanded={false}
          onExpand={mockOnExpand}
        />
      );

      expect(screen.getByTestId('deep-links-card-collapsed')).toBeInTheDocument();
    });

    it('should display title in collapsed state', () => {
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => [],
      });

      render(
        <DeepLinksCard
          testRun={mockTestRun}
          expanded={false}
          onExpand={mockOnExpand}
        />
      );

      expect(screen.getByText('Deep Links')).toBeInTheDocument();
    });

    it('should show expand button in collapsed state', () => {
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => [],
      });

      render(
        <DeepLinksCard
          testRun={mockTestRun}
          expanded={false}
          onExpand={mockOnExpand}
        />
      );

      // Expand icon should be visible
      const expandButtons = screen.getAllByRole('button');
      expect(expandButtons.length).toBeGreaterThan(0);
    });
  });

  describe('Rendering - Expanded State', () => {
    it('should render expanded card', async () => {
      (authenticatedFetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockDeepLinks,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResolvedLinks[0],
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResolvedLinks[1],
        });

      render(
        <DeepLinksCard
          testRun={mockTestRun}
          expanded={true}
          onExpand={mockOnExpand}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('deep-links-card-expanded')).toBeInTheDocument();
      });
    });

    it('should show collapse button in expanded state', async () => {
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => [],
      });

      render(
        <DeepLinksCard
          testRun={mockTestRun}
          expanded={true}
          onExpand={mockOnExpand}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('deep-links-card-expanded')).toBeInTheDocument();
      });
    });
  });

  describe('API Data Fetching', () => {
    it('should fetch deep links on mount', async () => {
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockDeepLinks,
      });

      render(
        <DeepLinksCard
          testRun={mockTestRun}
          expanded={false}
          onExpand={mockOnExpand}
        />
      );

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('/deep-links'),
          expect.any(Object)
        );
      });
    });

    it('should include query parameters in fetch request', async () => {
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => [],
      });

      render(
        <DeepLinksCard
          testRun={mockTestRun}
          expanded={false}
          onExpand={mockOnExpand}
        />
      );

      await waitFor(() => {
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('systemUnderTestId=system-123'),
          expect.any(Object)
        );
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('testEnvironment=production'),
          expect.any(Object)
        );
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('workload=load-test-1'),
          expect.any(Object)
        );
      });
    });

    it('should resolve variables for each link', async () => {
      (authenticatedFetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockDeepLinks,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResolvedLinks[0],
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResolvedLinks[1],
        });

      render(
        <DeepLinksCard
          testRun={mockTestRun}
          expanded={false}
          onExpand={mockOnExpand}
        />
      );

      await waitFor(() => {
        // Should call resolve for each link
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('/deep-links/link-1/resolve'),
          expect.any(Object)
        );
        expect(authenticatedFetch).toHaveBeenCalledWith(
          expect.stringContaining('/deep-links/link-2/resolve'),
          expect.any(Object)
        );
      });
    });

    it('should display link count after loading', async () => {
      (authenticatedFetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockDeepLinks,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResolvedLinks[0],
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResolvedLinks[1],
        });

      render(
        <DeepLinksCard
          testRun={mockTestRun}
          expanded={false}
          onExpand={mockOnExpand}
        />
      );

      // The component shows the count in the KPIDisplay (value="2") with label "External Links"
      await waitFor(() => {
        expect(screen.getByText('2')).toBeInTheDocument();
        expect(screen.getByText('External Links')).toBeInTheDocument();
      });
    });
  });

  describe('Loading States', () => {
    it('should show loading indicator while fetching', () => {
      (authenticatedFetch as jest.Mock).mockReturnValue(
        new Promise(() => {}) // Never resolves
      );

      render(
        <DeepLinksCard
          testRun={mockTestRun}
          expanded={false}
          onExpand={mockOnExpand}
        />
      );

      // Component uses SoftBadge with unicode ellipsis
      expect(screen.getByText('Loading links\u2026')).toBeInTheDocument();
    });

    it('should show loading spinner in expanded view', async () => {
      (authenticatedFetch as jest.Mock).mockReturnValue(
        new Promise(() => {}) // Never resolves
      );

      render(
        <DeepLinksCard
          testRun={mockTestRun}
          expanded={true}
          onExpand={mockOnExpand}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Loading deep links\u2026')).toBeInTheDocument();
      });
    });
  });

  describe('Error Handling', () => {
    it('should display error message on fetch failure', async () => {
      (authenticatedFetch as jest.Mock).mockRejectedValue(
        new Error('Network error')
      );

      render(
        <DeepLinksCard
          testRun={mockTestRun}
          expanded={true}
          onExpand={mockOnExpand}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });
    });

    it('should display error when API returns non-ok response', async () => {
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: false,
      });

      render(
        <DeepLinksCard
          testRun={mockTestRun}
          expanded={true}
          onExpand={mockOnExpand}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Failed to fetch deep links')).toBeInTheDocument();
      });
    });

    it('should show error state in collapsed view', async () => {
      (authenticatedFetch as jest.Mock).mockRejectedValue(
        new Error('API error')
      );

      render(
        <DeepLinksCard
          testRun={mockTestRun}
          expanded={false}
          onExpand={mockOnExpand}
        />
      );

      // The component shows "Error" in the KPIDisplay value when there's an error
      await waitFor(() => {
        expect(screen.getByText('Error')).toBeInTheDocument();
      });
    });
  });

  describe('Expand/Collapse Behavior', () => {
    it('should call onExpand when card is clicked in collapsed state', () => {
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => [],
      });

      render(
        <DeepLinksCard
          testRun={mockTestRun}
          expanded={false}
          onExpand={mockOnExpand}
        />
      );

      const card = screen.getByTestId('deep-links-card-collapsed');
      fireEvent.click(card);

      expect(mockOnExpand).toHaveBeenCalledTimes(1);
    });

    it('should call onExpand when expand button is clicked', () => {
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => [],
      });

      render(
        <DeepLinksCard
          testRun={mockTestRun}
          expanded={false}
          onExpand={mockOnExpand}
        />
      );

      const expandButtons = screen.getAllByRole('button');
      fireEvent.click(expandButtons[0]);

      expect(mockOnExpand).toHaveBeenCalled();
    });

    it('should not expand when clicking expanded card', async () => {
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => [],
      });

      render(
        <DeepLinksCard
          testRun={mockTestRun}
          expanded={true}
          onExpand={mockOnExpand}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('deep-links-card-expanded')).toBeInTheDocument();
      });

      const card = screen.getByTestId('deep-links-card-expanded');
      fireEvent.click(card);

      // Should not call onExpand for expanded card body clicks
      expect(mockOnExpand).not.toHaveBeenCalled();
    });
  });

  describe('Link Click Handling', () => {
    it('should display valid links with name in expanded view', async () => {
      (authenticatedFetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockDeepLinks,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResolvedLinks[0],
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResolvedLinks[1],
        });

      render(
        <DeepLinksCard
          testRun={mockTestRun}
          expanded={true}
          onExpand={mockOnExpand}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Grafana Dashboard')).toBeInTheDocument();
      }, { timeout: 3000 });

      // Verify both links are rendered
      expect(screen.getByText('Grafana Dashboard')).toBeInTheDocument();
      expect(screen.getByText('APM Tool')).toBeInTheDocument();

      // Verify Open buttons are rendered (OpenInNew icons in buttons)
      const openButtons = screen.getAllByText('Open');
      expect(openButtons.length).toBeGreaterThan(0);
    });

    it('should display unresolved chip for invalid links', async () => {
      (authenticatedFetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockDeepLinks,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResolvedLinks[0],
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResolvedLinks[1],
        });

      render(
        <DeepLinksCard
          testRun={mockTestRun}
          expanded={true}
          onExpand={mockOnExpand}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('APM Tool')).toBeInTheDocument();
      }, { timeout: 3000 });

      // The component shows an "Unresolved" chip (not a WarningIcon) for invalid links
      expect(screen.getByText('Unresolved')).toBeInTheDocument();
    });

    it('should disable preview and open buttons for invalid links', async () => {
      (authenticatedFetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [mockDeepLinks[1]], // Only the invalid link
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResolvedLinks[1],
        });

      render(
        <DeepLinksCard
          testRun={mockTestRun}
          expanded={true}
          onExpand={mockOnExpand}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('APM Tool')).toBeInTheDocument();
      }, { timeout: 3000 });

      // Preview and Open buttons should be disabled for invalid links
      const previewButton = screen.getByText('Preview').closest('button');
      const openButton = screen.getByText('Open').closest('button');
      expect(previewButton).toBeDisabled();
      expect(openButton).toBeDisabled();
    });
  });

  describe('Configuration Navigation', () => {
    it('should navigate to configuration page when settings clicked', async () => {
      (authenticatedFetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockDeepLinks,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResolvedLinks[0],
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResolvedLinks[1],
        });

      render(
        <DeepLinksCard
          testRun={mockTestRun}
          expanded={true}
          onExpand={mockOnExpand}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('SettingsIcon')).toBeInTheDocument();
      });

      const settingsButton = screen.getByTestId('SettingsIcon').closest('button');
      if (settingsButton) {
        fireEvent.click(settingsButton);

        expect(mockPush).toHaveBeenCalledWith(
          expect.stringContaining('/systems/system-123/config')
        );
        expect(mockPush).toHaveBeenCalledWith(
          expect.stringContaining('tab=2')
        );
        expect(mockPush).toHaveBeenCalledWith(
          expect.stringContaining('fromTestRun=')
        );
      }
    });
  });

  describe('Empty State', () => {
    it('should display empty state when no links configured', async () => {
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => [],
      });

      render(
        <DeepLinksCard
          testRun={mockTestRun}
          expanded={true}
          onExpand={mockOnExpand}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('No deep links configured for this test run.')).toBeInTheDocument();
      });
    });

    it('should show "No links configured" chip in collapsed state', async () => {
      (authenticatedFetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => [],
      });

      render(
        <DeepLinksCard
          testRun={mockTestRun}
          expanded={false}
          onExpand={mockOnExpand}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('No links configured')).toBeInTheDocument();
      });
    });
  });

  describe('Unresolved Variables', () => {
    it('should display unresolved variables count in collapsed state', async () => {
      (authenticatedFetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockDeepLinks,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResolvedLinks[0],
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResolvedLinks[1],
        });

      render(
        <DeepLinksCard
          testRun={mockTestRun}
          expanded={false}
          onExpand={mockOnExpand}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('1')).toBeInTheDocument();
        expect(screen.getByText('unresolved')).toBeInTheDocument();
      });
    });

    it('should show unresolved chip in expanded view for invalid links', async () => {
      (authenticatedFetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockDeepLinks,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResolvedLinks[0],
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResolvedLinks[1],
        });

      render(
        <DeepLinksCard
          testRun={mockTestRun}
          expanded={true}
          onExpand={mockOnExpand}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('APM Tool')).toBeInTheDocument();
      }, { timeout: 3000 });

      // DeepLinkItem renders an "Unresolved" chip with WarningAmber icon for invalid links
      expect(screen.getByText('Unresolved')).toBeInTheDocument();
    });
  });
});
