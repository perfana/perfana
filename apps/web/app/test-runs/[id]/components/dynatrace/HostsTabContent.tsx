'use client';

import { useState, useEffect } from 'react';
import { Box, Button, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { TestRun } from '@/types/test-runs';
import { DynatraceConfig, fetchHostsOverview, HostOverviewRow } from '@/lib/dynatrace';
import HostLabelChips from '@/components/HostLabelChips';
import HostCardLinksMenu from './HostCardLinksMenu';
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
  labels?: string[];
  createdAt: string;
  updatedAt: string;
}

interface HostsTabContentProps {
  hostEntities: DynatraceEntityMapping[];
  testRun: TestRun;
  configs: DynatraceConfig[];
}

// One request per host, this many in flight. Same ceiling the worker's Dynatrace
// client uses (DEFAULT_MAX_CONCURRENT), so a 100-host run cannot rate-limit the
// tenant. Each request costs 3 Dynatrace calls server-side.
const HOST_OVERVIEW_CONCURRENCY = 5;

export default function HostsTabContent({ hostEntities, testRun, configs }: HostsTabContentProps) {
  const [selectedHostId, setSelectedHostId] = useState<string | null>(null);
  const [rows, setRows] = useState<HostOverviewRow[]>([]);
  const [loading, setLoading] = useState(false);

  const first = hostEntities[0];
  const systemUnderTestId = first?.systemUnderTestId;
  // Scope comes from the RUN, never from hostEntities[0]. A `sut`-level mapping has
  // test_environment and workload NULL by design — that is what "applies to the whole
  // system" means — and mappings arrive ordered createdAt DESC, so one system-level
  // mapping sorting to the front sent `environment=&workload=` and the endpoint answered
  // 400 for every host, on every poll. The endpoint wants the concrete scope anyway:
  // DynatraceRepository.getEntityMappings resolves all three levels for it, so the
  // sut-level hosts come back too.
  const {
    test_environment: testEnvironment,
    workload,
    start_time: startTime,
    end_time: endTime,
  } = testRun;
  // Identity-stable dep: hostEntities is re-filtered on every parent render.
  const hostIdsKey = hostEntities.map((h) => h.entityId).join(',');

  // Fan out per host so the table fills in as answers arrive, rather than
  // blocking on one selector covering every host.
  useEffect(() => {
    setRows([]);
    // environment and workload are in the guard too: the endpoint requires all three and
    // answers 400 without them, so firing anyway would just be a 400 per host per poll.
    if (!systemUnderTestId || !testEnvironment || !workload || !startTime || !endTime || !hostIdsKey) return;

    let cancelled = false;
    const queue = hostIdsKey.split(',');
    setLoading(true);

    const worker = async () => {
      for (let hostId = queue.shift(); hostId && !cancelled; hostId = queue.shift()) {
        try {
          const data = await fetchHostsOverview(
            systemUnderTestId,
            testEnvironment,
            workload,
            startTime,
            endTime,
            hostId,
          );
          if (!cancelled) setRows((prev) => [...prev, ...data]);
        } catch (error) {
          // Soft-fail per host: the row keeps its "no data" dashes.
          console.error(`Failed to fetch host overview for ${hostId}:`, error);
        }
      }
    };

    Promise.all(Array.from({ length: HOST_OVERVIEW_CONCURRENCY }, worker)).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [hostIdsKey, systemUnderTestId, testEnvironment, workload, startTime, endTime]);

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
          <HostLabelChips labels={selectedHost.labels} />
          <HostCardLinksMenu hostDisplayName={selectedHost.entityDisplayName} />
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
