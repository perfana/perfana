'use client';

import { Box, Typography, Paper } from '@mui/material';
import { GroupRemove } from '@mui/icons-material';

/**
 * Displayed when an authenticated user has no organization memberships.
 * Directs them to contact an administrator for access.
 */
export function NoOrganizationMembership() {
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
        <GroupRemove sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
        <Typography variant="h6" gutterBottom>
          No organization access
        </Typography>
        <Typography variant="body2" color="text.secondary">
          You are not a member of any organization. Ask an administrator to add
          you to an organization so you can start using Perfana.
        </Typography>
      </Paper>
    </Box>
  );
}
