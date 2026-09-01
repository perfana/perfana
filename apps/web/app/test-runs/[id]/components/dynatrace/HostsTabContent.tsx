'use client';

import { useState, useEffect, useCallback } from 'react';
import { Box, Button, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { TestRun } from '@/types/test-runs';
import { DynatraceConfig, fetchHostsOverview, HostOverviewRow } from '@/lib/dynatrace';
import HostDetailPanel from './HostDetailPanel';
import HostsOverviewTable from './HostsOverviewTable';

interface DynatraceEntityMapping {
  id: string;
  entityId: string;
  entityDisplayName: string;
  entityType: string;
  dynatraceConfigId: string;
  systemUnderTestId: string;
  testEnvironment?: string;
  workload?: string;
  level: string;
  createdAt: string;
  updatedAt: string;
}

interface HostsTabContentProps {
  hostEntities: DynatraceEntityMapping[];
  testRun: TestRun;
  configs: DynatraceConfig[];
}

export default function HostsTabContent({ hostEntities, testRun, configs }: HostsTabContentProps) {
  const [selectedHostId, setSelectedHostId] = useState<string | null>(null);
  const [rows, setRows] = useState<HostOverviewRow[]>([]);
  const [loading, setLoading] = useState(false);

  const first = hostEntities[0];

  const loadOverview = useCallback(async () => {
    if (!first || !testRun.start_time || !testRun.end_time) {
      setRows([]);
      return;
    }
    try {
      setLoading(true);
      const data = await fetchHostsOverview(
        first.systemUnderTestId,
        first.testEnvironment ?? '',
        first.workload ?? '',
        testRun.start_time,
        testRun.end_time,
      );
      setRows(data);
    } catch (error) {
      console.error('Failed to fetch host overview:', error);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [first, testRun.start_time, testRun.end_time]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const selectedHost = hostEntities.find((h) => h.entityId === selectedHostId) ?? null;

  if (selectedHost) {
    return (
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
          <Button startIcon={<ArrowBackIcon />} onClick={() => setSelectedHostId(null)}>
            Back to hosts
          </Button>
          {/* Same name the hosts list shows, so the drill-down says which host it is. */}
          <Typography variant="h6" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>
            {selectedHost.entityDisplayName}
          </Typography>
        </Box>
        <HostDetailPanel
          host={selectedHost}
          testRun={testRun}
          // Each host belongs to a specific Dynatrace instance; use its own config, not always the first
          config={configs.find((c) => c.id === selectedHost.dynatraceConfigId) ?? configs[0]}
        />
      </Box>
    );
  }

  return (
    <HostsOverviewTable
      hosts={hostEntities}
      rows={rows}
      loading={loading}
      onSelectHost={setSelectedHostId}
    />
  );
}
