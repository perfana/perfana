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
import { useOrganizations } from '@/lib/hooks/use-organizations';
import { useOrganizationContext } from '@/lib/contexts/organization-context';
import {
  OrganizationCard,
  CreateOrganizationDialog,
} from '@/components/organizations';

export default function OrganizationsPage() {
  const router = useRouter();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const { data: organizations = [], isLoading, error } = useOrganizations();
  const { currentOrganizationId, selectOrganization } = useOrganizationContext();

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

  return (
    <Box sx={{ py: 4, px: 3 }}>
      {/* Header */}
      <Box
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        mb={4}
      >
        <Box>
          <Typography
            variant="h4"
            component="h1"
            sx={{ fontWeight: 700, color: 'text.primary', mb: 1 }}
          >
            Organizations
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Manage your organizations and their members
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => setCreateDialogOpen(true)}
          sx={{
            textTransform: 'none',
            fontWeight: 600,
          }}
        >
          Create Organization
        </Button>
      </Box>

      {/* Error state */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          Failed to load organizations:{' '}
          {error && typeof error === 'object' && 'message' in error
            ? (error as Error).message
            : 'Unknown error'}
        </Alert>
      )}

      {/* Organizations grid */}
      {organizations.length === 0 ? (
        <Box textAlign="center" py={8}>
          <Typography variant="h6" color="text.secondary" gutterBottom>
            No Organizations Yet
          </Typography>
          <Typography variant="body2" color="text.secondary" mb={3}>
            Create your first organization to start managing teams and members.
          </Typography>
          <Button
            variant="outlined"
            startIcon={<Add />}
            onClick={() => setCreateDialogOpen(true)}
            sx={{ textTransform: 'none' }}
          >
            Create Your First Organization
          </Button>
        </Box>
      ) : (
        <Grid container spacing={3}>
          {organizations.map((org) => (
            <Grid size={{ xs: 12, sm: 6, md: 4 }} key={org.id}>
              <OrganizationCard
                organization={org}
                isSelected={org.id === currentOrganizationId}
                onSelect={() => selectOrganization(org.id)}
                onViewDetails={() =>
                  router.push(`/settings/organizations/${org.id}`)
                }
              />
            </Grid>
          ))}
        </Grid>
      )}

      {/* Create Organization Dialog */}
      <CreateOrganizationDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
      />
    </Box>
  );
}
