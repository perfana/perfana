'use client';

import { useState } from 'react';
import { Box, Tabs, Tab } from '@mui/material';
import { TestRun } from '@/types/test-runs';
import { DynatraceConfig } from '@/lib/dynatrace';
import HostDetailPanel from './HostDetailPanel';

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

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`host-tabpanel-${index}`}
      aria-labelledby={`host-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ pt: 3 }}>{children}</Box>}
    </div>
  );
}

function a11yProps(index: number) {
  return {
    id: `host-tab-${index}`,
    'aria-controls': `host-tabpanel-${index}`,
  };
}

export default function HostsTabContent({
  hostEntities,
  testRun,
  configs
}: HostsTabContentProps) {
  const [tabValue, setTabValue] = useState(0);

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  const getHostColor = () => 'rgba(76, 175, 80, 0.8)'; // Green for hosts

  return (
    <Box>
      {/* Host tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tabs
          value={tabValue}
          onChange={handleTabChange}
          aria-label="host tabs"
          variant="scrollable"
          scrollButtons="auto"
        >
          {hostEntities.map((host, index) => (
            <Tab
              key={host.id}
              label={host.entityDisplayName}
              {...a11yProps(index)}
              sx={{
                color: getHostColor(),
                '&.Mui-selected': {
                  color: getHostColor(),
                }
              }}
            />
          ))}
        </Tabs>
      </Box>

      {/* Tab panels */}
      {hostEntities.map((host, index) => (
        <TabPanel key={host.id} value={tabValue} index={index}>
          <HostDetailPanel
            host={host}
            testRun={testRun}
            // Each host belongs to a specific Dynatrace instance; use its own config, not always the first
            config={configs.find(c => c.id === host.dynatraceConfigId) ?? configs[0]}
          />
        </TabPanel>
      ))}
    </Box>
  );
}
