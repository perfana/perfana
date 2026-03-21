'use client';

import { FC, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SystemSummary } from '@/lib/api';
import { Server, CheckCircle2, XCircle, Clock, Star, Settings, Search, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

/*
 * NOTE: This component uses inline `style` props extensively because the
 * Perfana design system CSS is imported outside any @layer, which causes it
 * to override Tailwind's @layer utilities in the CSS cascade. Inline styles
 * guarantee correct rendering in both light and dark modes.
 */

interface SystemsSummaryGridProps {
  systems: SystemSummary[];
  pinnedSystemIds?: Set<string>;
  onTogglePin?: (systemId: string) => void;
}

/* Shared inline-style constants */
const iconButton: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  padding: '6px',
  lineHeight: 0,
  borderRadius: '6px',
  transition: 'background 150ms ease',
};

export const SystemsSummaryGrid: FC<SystemsSummaryGridProps> = ({
  systems,
  pinnedSystemIds = new Set(),
  onTogglePin,
}) => {
  const router = useRouter();
  const [filter, setFilter] = useState('');
  const [filterFocused, setFilterFocused] = useState(false);

  const filteredSystems = useMemo(() => {
    if (!filter.trim()) return systems;
    const lowerFilter = filter.toLowerCase();
    return systems.filter((s) => s.name.toLowerCase().includes(lowerFilter));
  }, [systems, filter]);

  const { pinned, unpinned } = useMemo(() => {
    const sortByLastRun = (a: SystemSummary, b: SystemSummary) => {
      if (!a.lastTestRun && !b.lastTestRun) return 0;
      if (!a.lastTestRun) return 1;
      if (!b.lastTestRun) return -1;
      return new Date(b.lastTestRun).getTime() - new Date(a.lastTestRun).getTime();
    };

    const pinnedList: SystemSummary[] = [];
    const unpinnedList: SystemSummary[] = [];

    for (const system of filteredSystems) {
      if (pinnedSystemIds.has(system.id)) {
        pinnedList.push(system);
      } else {
        unpinnedList.push(system);
      }
    }

    pinnedList.sort(sortByLastRun);
    unpinnedList.sort(sortByLastRun);

    return { pinned: pinnedList, unpinned: unpinnedList };
  }, [filteredSystems, pinnedSystemIds]);

  if (systems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card p-12 text-center">
        <div className="mb-4 inline-flex rounded-full bg-muted p-3">
          <Server className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="mb-2 text-lg font-semibold text-foreground">No Systems Found</h3>
        <p className="text-sm text-muted-foreground">
          No systems under test have been configured yet
        </p>
      </div>
    );
  }

  const renderCard = (system: SystemSummary) => {
    const totalTests = system.passFailRatio.passed + system.passFailRatio.failed;
    const passRate = totalTests > 0
      ? Math.round((system.passFailRatio.passed / totalTests) * 100)
      : 0;
    const isHealthy = passRate >= 80;
    const isPinned = pinnedSystemIds.has(system.id);

    return (
      <Link
        key={system.id}
        href={`/test-runs?system=${encodeURIComponent(system.name)}`}
        className="group relative overflow-hidden rounded-lg border bg-card p-6 shadow-sm transition-all duration-200 hover:shadow-md"
        style={{
          borderColor: isPinned ? 'hsl(var(--border))' : 'hsl(var(--border))',
          boxShadow: isPinned ? '0 0 0 1px rgba(250, 204, 21, 0.15)' : undefined,
        }}
      >
        {/* Gradient Background Accent — raised opacity for dark mode visibility */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: isHealthy
              ? 'linear-gradient(to bottom right, rgba(34,197,94,0.08), rgba(34,197,94,0.04), transparent)'
              : 'linear-gradient(to bottom right, rgba(234,179,8,0.08), rgba(234,179,8,0.04), transparent)',
          }}
        />

        {/* Top Border Accent — refined 2px */}
        <div
          className="absolute top-0 left-0 right-0"
          style={{
            height: '2px',
            background: isHealthy
              ? 'linear-gradient(to right, #22c55e, #10b981)'
              : 'linear-gradient(to right, #eab308, #f59e0b)',
          }}
        />

        {/* Content */}
        <div className="relative">
          {/* Header */}
          <div className="mb-4 flex items-start justify-between">
            <div className="flex items-center">
              <div
                className="mr-3 rounded-lg p-2"
                style={{
                  backgroundColor: isHealthy
                    ? 'rgba(34, 197, 94, 0.15)'
                    : 'rgba(234, 179, 8, 0.15)',
                }}
              >
                <Server
                  style={{
                    width: '1.5rem',
                    height: '1.5rem',
                    color: isHealthy ? '#4ade80' : '#fbbf24',
                  }}
                />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-foreground group-hover:text-primary transition-colors">
                  {system.name}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {system.testRunCount} test runs
                </p>
              </div>
            </div>

            {/* Action Icons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              {onTogglePin && (
                <button
                  type="button"
                  title={isPinned ? 'Unpin system' : 'Pin system'}
                  aria-pressed={isPinned}
                  style={iconButton}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'hsl(var(--muted) / 0.6)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onTogglePin(system.id);
                  }}
                >
                  <Star
                    style={{
                      width: '1.125rem',
                      height: '1.125rem',
                      ...(isPinned
                        ? { fill: '#facc15', color: '#facc15' }
                        : { color: 'hsl(var(--foreground) / 0.45)' }),
                    }}
                  />
                </button>
              )}
              <button
                type="button"
                title="System configuration"
                style={iconButton}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'hsl(var(--muted) / 0.6)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  router.push(`/systems/${system.id}/config`);
                }}
              >
                <Settings
                  style={{ width: '1.125rem', height: '1.125rem', color: 'hsl(var(--foreground) / 0.45)' }}
                />
              </button>
            </div>
          </div>

          {/* Pass/Fail Ratio */}
          <div className="mb-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">Pass Rate</span>
              <span
                className="text-sm font-semibold"
                style={{ color: isHealthy ? '#4ade80' : '#fbbf24' }}
              >
                {passRate}%
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full transition-all duration-500"
                style={{
                  width: `${passRate}%`,
                  backgroundColor: isHealthy ? '#22c55e' : '#eab308',
                }}
              />
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center">
              <CheckCircle2 className="mr-2 h-4 w-4 text-green-500" />
              <div>
                <div className="text-xs text-muted-foreground">Passed</div>
                <div className="font-semibold text-foreground">
                  {system.passFailRatio.passed}
                </div>
              </div>
            </div>
            <div className="flex items-center">
              <XCircle className="mr-2 h-4 w-4 text-red-500" />
              <div>
                <div className="text-xs text-muted-foreground">Failed</div>
                <div className="font-semibold text-foreground">
                  {system.passFailRatio.failed}
                </div>
              </div>
            </div>
          </div>

          {/* Last Test Run — reduced spacing, no border divider */}
          {system.lastTestRun && (
            <div
              className="flex items-center text-xs"
              style={{ marginTop: '0.75rem', paddingTop: '0.75rem', color: 'hsl(var(--muted-foreground) / 0.7)' }}
            >
              <Clock style={{ width: '0.75rem', height: '0.75rem', marginRight: '0.25rem' }} />
              Last test:{' '}
              {formatDistanceToNow(new Date(system.lastTestRun), {
                addSuffix: true,
              })}
            </div>
          )}
        </div>
      </Link>
    );
  };

  return (
    <div>
      {/* Filter Input */}
      <div style={{ position: 'relative', marginBottom: '1.5rem', maxWidth: '28rem' }}>
        <Search
          style={{
            position: 'absolute',
            left: '0.75rem',
            top: '50%',
            transform: 'translateY(-50%)',
            width: '1rem',
            height: '1rem',
            color: 'hsl(var(--foreground) / 0.4)',
            pointerEvents: 'none',
          }}
        />
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onFocus={() => setFilterFocused(true)}
          onBlur={() => setFilterFocused(false)}
          placeholder="Filter systems by name..."
          style={{
            backgroundColor: 'hsl(var(--card))',
            color: 'hsl(var(--foreground))',
            width: '100%',
            padding: '0.5rem 2.25rem 0.5rem 2.5rem',
            border: filterFocused ? '1.5px solid hsl(var(--primary) / 0.7)' : '1.5px solid hsl(var(--border))',
            borderRadius: '0.5rem',
            fontSize: '0.875rem',
            outline: 'none',
            boxShadow: filterFocused
              ? '0 0 0 3px hsl(var(--primary) / 0.15), inset 0 1px 2px rgba(0,0,0,0.15)'
              : 'inset 0 1px 2px rgba(0,0,0,0.15)',
            transition: 'border-color 150ms ease, box-shadow 150ms ease',
          }}
        />
        {filter && (
          <button
            type="button"
            onClick={() => setFilter('')}
            style={{
              position: 'absolute',
              right: '0.75rem',
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'transparent',
              border: 'none',
              color: 'hsl(var(--muted-foreground))',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: '4px',
              lineHeight: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'hsl(var(--muted) / 0.5)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <X style={{ width: '0.875rem', height: '0.875rem' }} />
          </button>
        )}
      </div>

      {/* No Matching Systems — compact inline variant */}
      {filteredSystems.length === 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '1rem 0',
            color: 'hsl(var(--muted-foreground))',
            fontSize: '0.875rem',
          }}
        >
          <Search style={{ width: '1rem', height: '1rem', flexShrink: 0 }} />
          <span>
            No systems match &quot;{filter}&quot;.{' '}
            <button
              type="button"
              onClick={() => setFilter('')}
              style={{ background: 'none', border: 'none', color: 'hsl(var(--primary))', cursor: 'pointer', textDecoration: 'underline', font: 'inherit' }}
            >
              Clear filter
            </button>
          </span>
        </div>
      )}

      {/* Systems Grid */}
      {filteredSystems.length > 0 && (
        <div
          className="grid gap-6"
          style={{
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          }}
        >
          {/* Pinned section heading */}
          {pinned.length > 0 && (
            <div
              style={{
                gridColumn: '1 / -1',
                display: 'flex',
                alignItems: 'center',
                gap: '0.375rem',
                paddingBottom: '0.25rem',
              }}
            >
              <Star style={{ width: '0.875rem', height: '0.875rem', fill: '#facc15', color: '#facc15' }} />
              <span
                style={{
                  fontSize: '0.6875rem',
                  fontWeight: 500,
                  color: 'hsl(var(--muted-foreground))',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                Pinned
              </span>
            </div>
          )}

          {pinned.map(renderCard)}

          {/* Separator between pinned and unpinned */}
          {pinned.length > 0 && unpinned.length > 0 && (
            <div
              style={{
                gridColumn: '1 / -1',
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.25rem 0',
              }}
            >
              <div style={{ flex: 1, height: '1px', background: 'linear-gradient(to right, transparent, hsl(var(--border)), transparent)' }} />
              <span
                style={{
                  fontSize: '0.6875rem',
                  fontWeight: 500,
                  color: 'hsl(var(--muted-foreground))',
                  background: 'hsl(var(--muted) / 0.5)',
                  padding: '2px 10px',
                  borderRadius: '9999px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                All Systems
              </span>
              <div style={{ flex: 1, height: '1px', background: 'linear-gradient(to right, transparent, hsl(var(--border)), transparent)' }} />
            </div>
          )}

          {unpinned.map(renderCard)}
        </div>
      )}
    </div>
  );
};
