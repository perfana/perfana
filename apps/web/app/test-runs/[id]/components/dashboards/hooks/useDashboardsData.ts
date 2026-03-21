'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { authenticatedFetch } from '@/lib/api';
import { useThemeMode } from '@/contexts/theme-context';
import { TestRun } from '@/types/test-runs';
import { filterSystemTags } from '@perfana/shared/utils';
import { Dashboard } from '../types';
import { isArtificialDashboard, buildGrafanaIframeUrl } from '../utils';

interface UseDashboardsDataProps {
  testRun: TestRun;
  testRunId: string;
  dashboardsExpanded: boolean;
  onDashboardsExpand: () => void;
}

export function useDashboardsData({
  testRun,
  testRunId,
  dashboardsExpanded,
  onDashboardsExpand,
}: UseDashboardsDataProps) {
  const { mode } = useThemeMode();

  // Dashboard state
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [dashboardsLoading, setDashboardsLoading] = useState(false);
  const [selectedDashboardTags, setSelectedDashboardTags] = useState<string[]>([]);
  const [allDashboardTags, setAllDashboardTags] = useState<string[]>([]);
  const [dashboardSearchText, setDashboardSearchText] = useState('');
  const [expandedDashboard, setExpandedDashboard] = useState<Dashboard | null>(null);

  // Track last loaded combination to prevent unnecessary reloads
  const lastLoadedRef = useRef<string>('');

  // Load application dashboards from API
  const loadApplicationDashboards = useCallback(async () => {
    try {
      // Get system info from test run
      if (!testRun?.system_under_test_id) {
        setDashboards([]);
        setDashboardsLoading(false);
        return;
      }

      const systemId = testRun.system_under_test_id;
      const environment = testRun.test_environment;

      // Create a unique key for this system + environment combination
      const loadKey = `${systemId}-${environment}`;

      // Skip if already loaded for this combination (prevents flickering from repeated loads)
      if (lastLoadedRef.current === loadKey) {
        return;
      }

      setDashboardsLoading(true);

      const token = localStorage.getItem('perfana_access_token');
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      // Fetch application dashboards for this system and environment
      const queryParams = new URLSearchParams({
        systemId: systemId,
        environment: environment
      });

      const url = `/grafana/application-dashboards?${queryParams.toString()}`;

      const response = await authenticatedFetch(url, { headers });

      if (!response.ok) {
        const errorText = await response.text();

        if (response.status === 404) {
          setDashboards([]);
          // Mark as loaded to prevent retrying the same failed request
          lastLoadedRef.current = loadKey;
          return;
        }
        throw new Error(`Failed to fetch application dashboards: ${response.status} ${errorText}`);
      }

      const dashboardsData = await response.json();
      // Filter out artificial dashboards created by performance-metrics pipeline
      // These don't exist in Grafana and shouldn't be shown in the UI
      const realDashboards = dashboardsData.filter((d: Dashboard) => !isArtificialDashboard(d));
      setDashboards(realDashboards);

      // Extract unique tags for filtering (exclude system tags)
      const tagSet = new Set<string>();

      realDashboards.forEach((dashboard: Dashboard) => {
        if (dashboard.tags && Array.isArray(dashboard.tags)) {
          const filteredTags = filterSystemTags(dashboard.tags);
          filteredTags.forEach((tag: string) => {
            if (tag) {
              tagSet.add(tag);
            }
          });
        }
      });
      setAllDashboardTags(Array.from(tagSet).sort());

      // Update ref to mark this combination as loaded (prevents flickering from repeated loads)
      lastLoadedRef.current = loadKey;
    } catch {
      setDashboards([]);
    } finally {
      setDashboardsLoading(false);
    }
  }, [testRun?.system_under_test_id, testRun?.test_environment]);

  // Handle expand/collapse with optional tag preselection
  const handleDashboardsExpand = useCallback((preselectTag?: string) => {
    const wasCollapsed = !dashboardsExpanded;

    // Store the preselect tag in sessionStorage to survive component recreation
    if (preselectTag) {
      sessionStorage.setItem('dashboard-preselect-tag', preselectTag);
    }

    // Call parent callback to toggle expansion state
    onDashboardsExpand();

    // Auto-focus the card after expansion (only when expanding, not collapsing)
    if (wasCollapsed) {
      setTimeout(() => {
        const expandedCard = document.querySelector('[data-testid="dashboards-section-expanded"]');
        if (expandedCard) {
          // Focus only, no scrolling - expand in place
          (expandedCard as HTMLElement).focus({ preventScroll: true });
        }
      }, 300);
    }

    if (!dashboardsExpanded) {
      if (dashboards.length === 0) {
        loadApplicationDashboards();
      }
    }
  }, [dashboardsExpanded, dashboards.length, loadApplicationDashboards, onDashboardsExpand]);

  // Handle opening a dashboard in the modal
  const handleOpenDashboard = useCallback((dashboard: Dashboard) => {
    setExpandedDashboard(dashboard);
  }, []);

  // Handle closing the dashboard modal
  const handleCloseDashboard = useCallback(() => {
    setExpandedDashboard(null);
  }, []);

  // Toggle tag selection for filtering
  const toggleTagSelection = useCallback((tag: string) => {
    setSelectedDashboardTags(prev =>
      prev.includes(tag)
        ? prev.filter(t => t !== tag)
        : [...prev, tag]
    );
  }, []);

  // Filter dashboards based on selected tags (OR logic) and text search
  const filteredDashboards = dashboards.filter(dashboard => {
    // Text search filter
    const matchesSearch = dashboardSearchText === '' ||
      dashboard.dashboard_label.toLowerCase().includes(dashboardSearchText.toLowerCase());

    // Tag filter
    const matchesTags = selectedDashboardTags.length === 0 ||
      (dashboard.tags && dashboard.tags.some(tag => selectedDashboardTags.includes(tag)));

    return matchesSearch && matchesTags;
  });

  // Build iframe URL for a dashboard
  const buildIframeUrl = useCallback((dashboard: Dashboard) => {
    return buildGrafanaIframeUrl(dashboard, testRun, mode);
  }, [testRun, mode]);

  // Reset dashboards and ref when test run changes
  useEffect(() => {
    setDashboards([]);
    setAllDashboardTags([]);
    setSelectedDashboardTags([]);
    lastLoadedRef.current = '';
  }, [testRun?.id]);

  // Auto-load dashboards for TLDR display
  // Use testRun?.id instead of testRun to prevent re-triggers on object reference changes
  useEffect(() => {
    if (testRun?.id && dashboards.length === 0 && !dashboardsLoading) {
      loadApplicationDashboards();
    }
  }, [testRun?.id, dashboards.length, dashboardsLoading, loadApplicationDashboards]);

  // Apply preselected tag when dashboards are loaded and expanded
  useEffect(() => {
    const preselectTag = sessionStorage.getItem('dashboard-preselect-tag');

    if (dashboardsExpanded &&
        dashboards.length > 0 &&
        !dashboardsLoading &&
        preselectTag &&
        allDashboardTags.includes(preselectTag)) {

      setSelectedDashboardTags(prev => {
        return prev.includes(preselectTag) ? prev : [...prev, preselectTag];
      });

      // Clear the sessionStorage so we don't apply it again
      sessionStorage.removeItem('dashboard-preselect-tag');
    }
  }, [dashboardsExpanded, dashboards.length, dashboardsLoading, allDashboardTags]);

  return {
    // Data
    dashboards,
    filteredDashboards,
    allDashboardTags,

    // Loading states
    dashboardsLoading,

    // Selection state
    selectedDashboardTags,
    dashboardSearchText,
    expandedDashboard,

    // Actions
    setSelectedDashboardTags,
    setDashboardSearchText,
    setExpandedDashboard,
    toggleTagSelection,
    handleOpenDashboard,
    handleCloseDashboard,
    handleDashboardsExpand,
    loadApplicationDashboards,
    buildGrafanaIframeUrl: buildIframeUrl,
  };
}
