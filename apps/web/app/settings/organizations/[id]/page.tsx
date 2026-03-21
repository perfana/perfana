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
  Business,
} from '@mui/icons-material';
import NextLink from 'next/link';
import { useOrganization } from '@/lib/hooks/use-organizations';
import {
  OrganizationSettingsTab,
  OrganizationMembersTab,
  OrganizationTeamsTab,
} from '@/components/organizations';

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
      id={`org-tabpanel-${index}`}
      aria-labelledby={`org-tab-${index}`}
    >
      {value === index && <Box sx={{ py: 3 }}>{children}</Box>}
    </Box>
  );
}

function a11yProps(index: number) {
  return {
    id: `org-tab-${index}`,
    'aria-controls': `org-tabpanel-${index}`,
  };
}

export default function OrganizationDetailPage() {
  const router = useRouter();
  const params = useParams();
  const organizationId = params.id as string;

  const [tabValue, setTabValue] = useState(0);

  const { data: organization, isLoading, error } = useOrganization(organizationId);

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

  if (error || !organization) {
    return (
      <Box sx={{ py: 4, px: 3 }}>
        <Breadcrumbs sx={{ mb: 2 }}>
          <MuiLink
            component={NextLink}
            href="/settings/organizations"
            underline="hover"
            color="inherit"
          >
            Organizations
          </MuiLink>
          <Typography color="text.primary">Not Found</Typography>
        </Breadcrumbs>

        <Alert severity="error" sx={{ mb: 3 }}>
          {error && typeof error === 'object' && 'message' in error
            ? (error as Error).message
            : 'Organization not found'}
        </Alert>
        <Button
          startIcon={<ArrowBack />}
          onClick={() => router.push('/settings/organizations')}
          sx={{ textTransform: 'none' }}
        >
          Back to Organizations
        </Button>
      </Box>
    );
  }

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  const handleDeleted = () => {
    router.push('/settings/organizations');
  };

  return (
    <Box sx={{ py: 4, px: 3 }}>
      {/* Breadcrumbs */}
      <Breadcrumbs sx={{ mb: 2 }}>
        <MuiLink
          component={NextLink}
          href="/settings/organizations"
          underline="hover"
          color="inherit"
        >
          Organizations
        </MuiLink>
        <Typography color="text.primary">{organization.name}</Typography>
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
              'linear-gradient(135deg, rgba(25, 118, 210, 0.1) 0%, rgba(25, 118, 210, 0.05) 100%)',
            color: 'primary.main',
          }}
        >
          <Business sx={{ fontSize: 32 }} />
        </Box>
        <Box>
          <Typography
            variant="h4"
            component="h1"
            sx={{ fontWeight: 700, color: 'text.primary' }}
          >
            {organization.name}
          </Typography>
          {organization.description && (
            <Typography variant="body1" color="text.secondary">
              {organization.description}
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
            aria-label="Organization tabs"
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
              icon={<Groups sx={{ fontSize: 20 }} />}
              iconPosition="start"
              label="Teams"
              {...a11yProps(2)}
            />
          </Tabs>
        </Box>

        <Box sx={{ p: 3 }}>
          {/* Tab Panels */}
          <TabPanel value={tabValue} index={0}>
            <OrganizationSettingsTab
              organization={organization}
              onDeleted={handleDeleted}
            />
          </TabPanel>
          <TabPanel value={tabValue} index={1}>
            <OrganizationMembersTab organizationId={organizationId} />
          </TabPanel>
          <TabPanel value={tabValue} index={2}>
            <OrganizationTeamsTab organizationId={organizationId} />
          </TabPanel>
        </Box>
      </Paper>
    </Box>
  );
}
