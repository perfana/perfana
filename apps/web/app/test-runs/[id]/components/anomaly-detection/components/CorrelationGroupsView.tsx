'use client';

import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  CircularProgress,
  Alert,
  Paper,
  Chip,
  Divider,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { authenticatedFetch } from '@/lib/api';

// --- Types ---------------------------------------------------------------

interface CorrelationGroupMember {
  resultId: string;
  metricName: string;
  dashboardLabel: string;
  panelTitle: string;
  conclusionLabel: string | null;
  correlationToDriver: number;
}

interface CorrelationGroup {
  id: string;
  label: string;
  size: number;
  avgCorrelation: number;
  driver: {
    resultId: string;
    metricName: string;
    panelTitle: string;
  };
  members: CorrelationGroupMember[];
}

interface UngroupedItem {
  resultId: string;
  metricName: string;
  dashboardLabel: string;
  panelTitle: string;
  conclusionLabel: string | null;
}

interface CorrelationGroupsResponse {
  testRunId: string;
  threshold: number;
  groups: CorrelationGroup[];
  ungrouped: UngroupedItem[];
}

// --- Component -----------------------------------------------------------

interface CorrelationGroupsViewProps {
  testRunId: string;
}

export default function CorrelationGroupsView({ testRunId }: CorrelationGroupsViewProps) {
  const [data, setData] = useState<CorrelationGroupsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!testRunId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const res = await authenticatedFetch(
          `/adapt/correlation-groups/${encodeURIComponent(testRunId)}`
        );
        if (cancelled) return;
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = (await res.json()) as CorrelationGroupsResponse;
        if (!cancelled) {
          setData(json);
        }
      } catch (err) {
        if (!cancelled) {
          const msg =
            err && typeof err === 'object' && 'message' in err
              ? (err as Error).message
              : 'Unknown error';
          setError(`Failed to load correlation groups: ${msg}`);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [testRunId]);

  // --- Loading ---
  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
        <CircularProgress size={32} />
      </Box>
    );
  }

  // --- Error ---
  if (error) {
    return (
      <Alert severity="error" sx={{ mb: 2 }}>
        {error}
      </Alert>
    );
  }

  // --- Empty ---
  if (!data || data.groups.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 4 }}>
        <Typography variant="body1" color="text.secondary">
          No correlation groups found for this test run.
        </Typography>
        {data && data.ungrouped.length > 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {data.ungrouped.length} metric{data.ungrouped.length !== 1 ? 's' : ''} could not be grouped.
          </Typography>
        )}
      </Box>
    );
  }

  const { groups, ungrouped, threshold } = data;

  return (
    <Box sx={{ width: '100%' }}>
      {/* Header info */}
      <Box sx={{ mb: 2 }}>
        <Typography variant="body2" color="text.secondary">
          {groups.length} group{groups.length !== 1 ? 's' : ''} detected
          {' '}(correlation threshold: {typeof threshold === 'number' ? threshold.toFixed(2) : threshold})
        </Typography>
      </Box>

      {/* Groups */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {groups.map((group) => (
          <GroupCard key={group.id} group={group} />
        ))}
      </Box>

      {/* Ungrouped */}
      {ungrouped.length > 0 && (
        <Box sx={{ mt: 3 }}>
          <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
            Ungrouped ({ungrouped.length})
          </Typography>
          <Paper
            variant="outlined"
            sx={(theme) => ({
              p: 2,
              borderColor: alpha(theme.palette.divider, 0.6),
              borderRadius: 2,
            })}
          >
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {ungrouped.map((item) => (
                <Chip
                  key={item.resultId}
                  label={item.metricName}
                  size="small"
                  variant="outlined"
                  sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
                />
              ))}
            </Box>
          </Paper>
        </Box>
      )}
    </Box>
  );
}

// --- GroupCard sub-component ---------------------------------------------

function GroupCard({ group }: { group: CorrelationGroup }) {
  const avgCorr =
    typeof group.avgCorrelation === 'number'
      ? group.avgCorrelation.toFixed(2)
      : group.avgCorrelation;

  return (
    <Paper
      variant="outlined"
      sx={(theme) => ({
        p: 2.5,
        borderRadius: 2,
        borderColor: alpha(theme.palette.primary.main, 0.2),
        backgroundColor: alpha(theme.palette.primary.main, 0.02),
      })}
    >
      {/* Group header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          mb: 1.5,
          flexWrap: 'wrap',
        }}
      >
        <Typography variant="subtitle1" sx={{ fontWeight: 600, flexGrow: 1 }}>
          {group.label}
        </Typography>
        <Chip
          label={`${group.size} metric${group.size !== 1 ? 's' : ''}`}
          size="small"
          color="primary"
          variant="outlined"
        />
        <Chip
          label={`avg |r| ${avgCorr}`}
          size="small"
          variant="outlined"
        />
      </Box>

      {/* Driver metric */}
      <Box
        sx={(theme) => ({
          mb: 1.5,
          p: 1.5,
          borderRadius: 1.5,
          backgroundColor: alpha(theme.palette.warning.main, 0.06),
          border: `1px solid ${alpha(theme.palette.warning.main, 0.2)}`,
        })}
      >
        <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Driver metric
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 600, mt: 0.25, fontFamily: 'monospace' }}>
          {group.driver.metricName}
        </Typography>
        {group.driver.panelTitle && (
          <Typography variant="caption" color="text.secondary">
            {group.driver.panelTitle}
          </Typography>
        )}
      </Box>

      {/* Members */}
      {group.members.length > 0 && (
        <>
          <Divider sx={{ mb: 1.5 }} />
          <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', mb: 1 }}>
            Members
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            {group.members.map((member) => {
              const corrVal =
                typeof member.correlationToDriver === 'number'
                  ? member.correlationToDriver.toFixed(2)
                  : member.correlationToDriver;
              return (
                <Box
                  key={member.resultId}
                  sx={(theme) => ({
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    flexWrap: 'wrap',
                    p: 1,
                    borderRadius: 1,
                    '&:hover': {
                      backgroundColor: alpha(theme.palette.action.hover, 0.5),
                    },
                  })}
                >
                  <Typography
                    variant="body2"
                    sx={{ flexGrow: 1, fontFamily: 'monospace', fontSize: '0.8rem' }}
                  >
                    {member.metricName}
                  </Typography>
                  <Chip
                    label={`r = ${corrVal}`}
                    size="small"
                    variant="outlined"
                    sx={{ fontSize: '0.7rem', height: 20 }}
                  />
                  {member.conclusionLabel && (
                    <Chip
                      label={member.conclusionLabel}
                      size="small"
                      sx={{ fontSize: '0.7rem', height: 20 }}
                    />
                  )}
                </Box>
              );
            })}
          </Box>
        </>
      )}
    </Paper>
  );
}
