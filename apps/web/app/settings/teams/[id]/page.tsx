'use client';

import { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  Box,
  Typography,
  CircularProgress,
  Alert,
  Breadcrumbs,
  Link as MuiLink,
  Tabs,
  Tab,
  Button,
  Paper,
} from '@mui/material';
import {
  ArrowBack,
  Settings,
  People,
  Groups,
  Computer,
} from '@mui/icons-material';
import NextLink from 'next/link';
import { useTeam } from '@/lib/hooks/use-teams';
import { TeamSettingsTab, TeamMembersTab, TeamSystemsTab } from '@/components/teams';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel({ children, value, index }: TabPanelProps) {
  return (
    <Box
      role="tabpanel"
      hidden={value !== index}
      id={`team-tabpanel-${index}`}
      aria-labelledby={`team-tab-${index}`}
    >
      {value === index && <Box sx={{ py: 3 }}>{children}</Box>}
    </Box>
  );
}

function a11yProps(index: number) {
  return {
    id: `team-tab-${index}`,
    'aria-controls': `team-tabpanel-${index}`,
  };
}

export default function TeamDetailPage() {
  const router = useRouter();
  const params = useParams();
  const teamId = params.id as string;

  const [tabValue, setTabValue] = useState(0);

  const { data: team, isLoading, error } = useTeam(teamId);

  if (isLoading) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        minHeight="400px"
      >
        <CircularProgress size={40} />
      </Box>
    );
  }

  if (error || !team) {
    return (
      <Box sx={{ py: 4, px: 3 }}>
        <Breadcrumbs sx={{ mb: 2 }}>
          <MuiLink
            component={NextLink}
            href="/settings/teams"
            underline="hover"
            color="inherit"
          >
            Teams
          </MuiLink>
          <Typography color="text.primary">Not Found</Typography>
        </Breadcrumbs>

        <Alert severity="error" sx={{ mb: 3 }}>
          {error && typeof error === 'object' && 'message' in error
            ? (error as Error).message
            : 'Team not found'}
        </Alert>
        <Button
          startIcon={<ArrowBack />}
          onClick={() => router.push('/settings/teams')}
          sx={{ textTransform: 'none' }}
        >
          Back to Teams
        </Button>
      </Box>
    );
  }

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  const handleDeleted = () => {
    router.push('/settings/teams');
  };

  return (
    <Box sx={{ py: 4, px: 3 }}>
      {/* Breadcrumbs */}
      <Breadcrumbs sx={{ mb: 2 }}>
        <MuiLink
          component={NextLink}
          href="/settings/teams"
          underline="hover"
          color="inherit"
        >
          Teams
        </MuiLink>
        <Typography color="text.primary">{team.name}</Typography>
      </Breadcrumbs>

      {/* Header */}
      <Box display="flex" alignItems="center" gap={2} mb={4}>
        <Box
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 56,
            height: 56,
            borderRadius: '12px',
            background:
              'linear-gradient(135deg, rgba(156, 39, 176, 0.1) 0%, rgba(156, 39, 176, 0.05) 100%)',
            color: 'secondary.main',
          }}
        >
          <Groups sx={{ fontSize: 32 }} />
        </Box>
        <Box>
          <Typography
            variant="h4"
            component="h1"
            sx={{ fontWeight: 700, color: 'text.primary' }}
          >
            {team.name}
          </Typography>
          {team.description && (
            <Typography variant="body1" color="text.secondary">
              {team.description}
            </Typography>
          )}
        </Box>
      </Box>

      {/* Tabs */}
      <Paper
        elevation={0}
        sx={{
          borderRadius: 2,
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tabs
            value={tabValue}
            onChange={handleTabChange}
            aria-label="Team tabs"
            sx={{
              px: 2,
              '& .MuiTab-root': {
                textTransform: 'none',
                fontWeight: 500,
                minHeight: 56,
              },
            }}
          >
            <Tab
              icon={<Settings sx={{ fontSize: 20 }} />}
              iconPosition="start"
              label="Settings"
              {...a11yProps(0)}
            />
            <Tab
              icon={<People sx={{ fontSize: 20 }} />}
              iconPosition="start"
              label="Members"
              {...a11yProps(1)}
            />
            <Tab
              icon={<Computer sx={{ fontSize: 20 }} />}
              iconPosition="start"
              label="Systems"
              {...a11yProps(2)}
            />
          </Tabs>
        </Box>

        <Box sx={{ p: 3 }}>
          {/* Tab Panels */}
          <TabPanel value={tabValue} index={0}>
            <TeamSettingsTab team={team} onDeleted={handleDeleted} />
          </TabPanel>
          <TabPanel value={tabValue} index={1}>
            <TeamMembersTab teamId={teamId} />
          </TabPanel>
          <TabPanel value={tabValue} index={2}>
            <TeamSystemsTab teamId={teamId} />
          </TabPanel>
        </Box>
      </Paper>
    </Box>
  );
}
