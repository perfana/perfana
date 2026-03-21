'use client';

import { RefreshCw } from 'lucide-react';
import { useDashboardData } from '@/hooks/useDashboardData';
import { usePinnedSystems } from '@/hooks/usePinnedSystems';
import { StatisticsCards } from '@/components/dashboard/StatisticsCards';
import { RecentFailuresTable } from '@/components/dashboard/RecentFailuresTable';
import { SystemsSummaryGrid } from '@/components/dashboard/SystemsSummaryGrid';
import { TimePeriodSelector } from '@/components/dashboard/TimePeriodSelector';
import { useOrganizationContext } from '@/lib/contexts/organization-context';
import { useAuth } from '@/contexts/auth-context';
import { Box, Typography } from '@mui/material';
import { Business } from '@mui/icons-material';
import { NoOrganizationMembership } from '@/components/NoOrganizationMembership';
import { NoOrganizationsExist } from '@/components/NoOrganizationsExist';

export default function HomePage() {
  const { currentOrganizationId, isReady, isSelectorReadOnly, hasNoOrganizations, isAdmin, organizations } = useOrganizationContext();
  const { user } = useAuth();
  const { pinnedSystemIds, togglePin } = usePinnedSystems({
    userId: user?.id,
    organizationId: currentOrganizationId,
  });

  const {
    statistics,
    failures,
    systems,
    loading,
    error,
    timePeriod,
    setTimePeriod,
    customTimeRange,
    setCustomTimeRange,
    refresh,
    isLive,
  } = useDashboardData({
    organizationId: currentOrganizationId,
  });

  if (hasNoOrganizations) {
    return <NoOrganizationMembership />;
  }

  // Show prompt if org selection is required but not yet made
  // (read-only users are auto-selected, so they skip this)
  if (!isSelectorReadOnly && !isReady) {
    return (
      <Box sx={{ display: 'flex', minHeight: '60vh', alignItems: 'center', justifyContent: 'center' }}>
        <Box sx={{ textAlign: 'center' }}>
          <Business sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>
            Select an organization
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Choose an organization from the sidebar to view dashboard data.
          </Typography>
        </Box>
      </Box>
    );
  }

  if (loading && !statistics) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="mb-4 inline-flex h-12 w-12 animate-spin items-center justify-center rounded-full border-4 border-border border-t-primary"></div>
          <p className="text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <span className="text-2xl">Warning</span>
          </div>
          <h2 className="mb-2 text-xl font-semibold text-foreground">Error Loading Dashboard</h2>
          <p className="mb-4 text-muted-foreground">{error}</p>
          <button
            onClick={refresh}
            className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Page Header */}
      <div className="flex items-center justify-end mb-6">
        {/* Time Period Selector */}
        <TimePeriodSelector
          value={timePeriod}
          onChange={setTimePeriod}
          customTimeRange={customTimeRange}
          onCustomTimeRangeChange={setCustomTimeRange}
          onApplyCustomRange={refresh}
          loading={loading}
        />
      </div>

      {/* Statistics Cards */}
      {statistics && (
        <section className="mb-12">
          <StatisticsCards statistics={statistics} />
        </section>
      )}

      {/* Recent Failures Section */}
      <section className="mb-12">
        <div className="mt-8 mb-6">
          <h2 className="text-xl font-semibold text-foreground">Recently Failed Test Runs that might need your attention</h2>
        </div>
        <RecentFailuresTable failures={failures} />
      </section>

      {/* Systems Summary Section */}
      <section className="mb-12">
        <div className="mt-8 mb-6">
          <h2 className="text-xl font-semibold text-foreground">Systems Under Test</h2>
        </div>
        <SystemsSummaryGrid systems={systems} pinnedSystemIds={pinnedSystemIds} onTogglePin={togglePin} />
      </section>
    </div>
  );
}
