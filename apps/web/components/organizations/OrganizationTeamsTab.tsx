'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Box,
  Typography,
  Button,
  CircularProgress,
  Alert,
  Grid,
} from '@mui/material';
import { Add } from '@mui/icons-material';
import { useTeamsByOrganization } from '@/lib/hooks/use-teams';
import { TeamCard } from '../teams/TeamCard';
import { CreateTeamDialog } from '../teams/CreateTeamDialog';

interface OrganizationTeamsTabProps {
  organizationId: string;
}

export function OrganizationTeamsTab({
  organizationId,
}: OrganizationTeamsTabProps) {
  const router = useRouter();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const { data: teams = [], isLoading, error } = useTeamsByOrganization(organizationId);

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" py={4}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ mt: 2 }}>
        Failed to load teams:{' '}
        {error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Unknown error'}
      </Alert>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Box
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        mb={3}
      >
        <Typography variant="h6">Teams ({teams.length})</Typography>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => setCreateDialogOpen(true)}
          sx={{ textTransform: 'none' }}
        >
          Create Team
        </Button>
      </Box>

      {/* Teams grid */}
      {teams.length === 0 ? (
        <Box textAlign="center" py={6}>
          <Typography variant="h6" color="text.secondary" gutterBottom>
            No Teams Yet
          </Typography>
          <Typography variant="body2" color="text.secondary" mb={3}>
            Create teams to organize members and resources within this
            organization.
          </Typography>
          <Button
            variant="outlined"
            startIcon={<Add />}
            onClick={() => setCreateDialogOpen(true)}
            sx={{ textTransform: 'none' }}
          >
            Create First Team
          </Button>
        </Box>
      ) : (
        <Grid container spacing={3}>
          {teams.map((team) => (
            <Grid size={{ xs: 12, sm: 6, md: 4 }} key={team.id}>
              <TeamCard
                team={team}
                onViewDetails={() =>
                  router.push(`/settings/teams/${team.id}`)
                }
              />
            </Grid>
          ))}
        </Grid>
      )}

      {/* Create Team Dialog */}
      <CreateTeamDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        organizationId={organizationId}
      />
    </Box>
  );
}
