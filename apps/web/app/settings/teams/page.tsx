'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Box,
  Typography,
  Button,
  CircularProgress,
  Alert,
  Grid,
  Breadcrumbs,
  Link as MuiLink,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import { Add, FilterList } from '@mui/icons-material';
import NextLink from 'next/link';
import { useTeams, useTeamsByOrganization } from '@/lib/hooks/use-teams';
import { useOrganizationContext } from '@/lib/contexts/organization-context';
import { TeamCard, CreateTeamDialog } from '@/components/teams';

export default function TeamsPage() {
  const router = useRouter();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedOrgFilter, setSelectedOrgFilter] = useState<string>('all');

  const {
    organizations,
    currentOrganizationId,
    isLoading: orgsLoading,
  } = useOrganizationContext();

  // Sync page filter with sidebar org selector
  useEffect(() => {
    setSelectedOrgFilter(currentOrganizationId || 'all');
  }, [currentOrganizationId]);

  // Fetch teams based on filter
  const {
    data: allTeams = [],
    isLoading: allTeamsLoading,
    error: allTeamsError,
  } = useTeams();

  const {
    data: filteredTeams = [],
    isLoading: filteredTeamsLoading,
    error: filteredTeamsError,
  } = useTeamsByOrganization(
    selectedOrgFilter !== 'all' ? selectedOrgFilter : undefined
  );

  // Use filtered teams if an org is selected, otherwise use all teams
  const teams = selectedOrgFilter !== 'all' ? filteredTeams : allTeams;
  const isLoading =
    orgsLoading ||
    (selectedOrgFilter !== 'all' ? filteredTeamsLoading : allTeamsLoading);
  const error = selectedOrgFilter !== 'all' ? filteredTeamsError : allTeamsError;

  // Get organization name helper
  const getOrganizationName = (orgId: string): string => {
    const org = organizations.find((o) => o.id === orgId);
    return org?.name || 'Unknown';
  };

  // Determine which organization to use for creating a new team
  const getOrganizationIdForCreate = (): string | null => {
    if (selectedOrgFilter !== 'all') {
      return selectedOrgFilter;
    }
    if (currentOrganizationId) {
      return currentOrganizationId;
    }
    if (organizations.length > 0) {
      return organizations[0].id;
    }
    return null;
  };

  const handleCreateClick = () => {
    const orgId = getOrganizationIdForCreate();
    if (!orgId) {
      return;
    }
    setCreateDialogOpen(true);
  };

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

  const orgIdForCreate = getOrganizationIdForCreate();

  return (
    <Box sx={{ py: 4, px: 3 }}>
      {/* Header */}
      <Box
        display="flex"
        justifyContent="space-between"
        alignItems="flex-start"
        mb={4}
        flexWrap="wrap"
        gap={2}
      >
        <Box>
          <Typography
            variant="h4"
            component="h1"
            sx={{ fontWeight: 700, color: 'text.primary', mb: 1 }}
          >
            Teams
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Manage your teams and their members
          </Typography>
        </Box>
        <Box display="flex" gap={2} alignItems="center" flexWrap="wrap">
          {/* Organization Filter */}
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel id="org-filter-label">
              <Box display="flex" alignItems="center" gap={0.5}>
                <FilterList fontSize="small" />
                Filter by Organization
              </Box>
            </InputLabel>
            <Select
              labelId="org-filter-label"
              id="org-filter"
              value={selectedOrgFilter}
              label="Filter by Organization"
              onChange={(e) => setSelectedOrgFilter(e.target.value)}
            >
              <MenuItem value="all">All Organizations</MenuItem>
              {organizations.map((org) => (
                <MenuItem key={org.id} value={org.id}>
                  {org.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={handleCreateClick}
            disabled={!orgIdForCreate}
            sx={{
              textTransform: 'none',
              fontWeight: 600,
              background:
                'linear-gradient(135deg, rgba(156, 39, 176, 1) 0%, rgba(171, 71, 188, 1) 100%)',
              boxShadow: '0 2px 8px rgba(156, 39, 176, 0.3)',
              '&:hover': {
                background:
                  'linear-gradient(135deg, rgba(142, 36, 170, 1) 0%, rgba(156, 39, 176, 1) 100%)',
                boxShadow: '0 4px 12px rgba(156, 39, 176, 0.4)',
              },
              '&:disabled': {
                background: 'rgba(0, 0, 0, 0.12)',
              },
            }}
          >
            Create Team
          </Button>
        </Box>
      </Box>

      {/* No organizations message */}
      {organizations.length === 0 && (
        <Alert severity="info" sx={{ mb: 3 }}>
          You need to create an organization before you can create teams.{' '}
          <MuiLink component={NextLink} href="/settings/organizations">
            Go to Organizations
          </MuiLink>
        </Alert>
      )}

      {/* Error state */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          Failed to load teams:{' '}
          {error && typeof error === 'object' && 'message' in error
            ? (error as Error).message
            : 'Unknown error'}
        </Alert>
      )}

      {/* Teams grid */}
      {teams.length === 0 ? (
        <Box textAlign="center" py={8}>
          <Typography variant="h6" color="text.secondary" gutterBottom>
            {selectedOrgFilter !== 'all'
              ? 'No Teams in This Organization'
              : 'No Teams Yet'}
          </Typography>
          <Typography variant="body2" color="text.secondary" mb={3}>
            {selectedOrgFilter !== 'all'
              ? 'Create a team to start organizing your members.'
              : organizations.length > 0
                ? 'Create your first team to start organizing your members.'
                : 'Create an organization first, then you can create teams.'}
          </Typography>
          {orgIdForCreate && (
            <Button
              variant="outlined"
              startIcon={<Add />}
              onClick={handleCreateClick}
              sx={{
                textTransform: 'none',
                borderColor: 'secondary.main',
                color: 'secondary.main',
                '&:hover': {
                  borderColor: 'secondary.dark',
                  backgroundColor: 'rgba(156, 39, 176, 0.04)',
                },
              }}
            >
              Create Your First Team
            </Button>
          )}
        </Box>
      ) : (
        <Grid container spacing={3}>
          {teams.map((team) => (
            <Grid size={{ xs: 12, sm: 6, md: 4 }} key={team.id}>
              <TeamCard
                team={team}
                organizationName={getOrganizationName(team.organization_id)}
                onViewDetails={() => router.push(`/settings/teams/${team.id}`)}
              />
            </Grid>
          ))}
        </Grid>
      )}

      {/* Create Team Dialog */}
      {orgIdForCreate && (
        <CreateTeamDialog
          open={createDialogOpen}
          onClose={() => setCreateDialogOpen(false)}
          organizationId={orgIdForCreate}
        />
      )}
    </Box>
  );
}
