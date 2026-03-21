'use client';

import { Box, Typography, Paper, Button } from '@mui/material';
import { Add, Business } from '@mui/icons-material';
import { useRouter } from 'next/navigation';

/**
 * Displayed to admins when no organizations exist in the system yet.
 * Directs them to create the first organization.
 */
export function NoOrganizationsExist() {
  const router = useRouter();

  return (
    <Box sx={{ display: 'flex', minHeight: '60vh', alignItems: 'center', justifyContent: 'center' }}>
      <Paper
        elevation={0}
        sx={{
          textAlign: 'center',
          maxWidth: 440,
          p: 4,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2,
        }}
      >
        <Business sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
        <Typography variant="h6" gutterBottom>
          No organizations yet
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Create your first organization to start using Perfana.
        </Typography>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => router.push('/settings/organizations')}
        >
          Create Organization
        </Button>
      </Paper>
    </Box>
  );
}
