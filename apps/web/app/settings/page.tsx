'use client';

import { useState } from 'react';
import {
  Box,
  Typography,
  CircularProgress,
  Snackbar,
} from '@mui/material';
import {
  Settings,
  Notifications as NotificationsIcon,
  NotificationsActive as AlertFiltersIcon,
} from '@mui/icons-material';

// Types
import { SnackbarState, SECTION_COLORS } from './types';

// Hooks
import { useApiKeys } from './hooks';

// Components
import {
  ApiKeyFormDialog,
  ApiKeyDeleteDialog,
  ApiKeyCard,
  SettingsSectionCard,
} from './components';

export default function SettingsPage() {
  const [snackbar, setSnackbar] = useState<SnackbarState>({
    open: false,
    message: '',
    severity: 'success',
  });

  const handleSnackbar = (state: SnackbarState) => setSnackbar(state);

  // API Keys hook
  const apiKeys = useApiKeys({ onSnackbar: handleSnackbar });

  if (apiKeys.loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress size={40} />
      </Box>
    );
  }

  return (
    <Box sx={{ py: 4, px: 3 }}>
      {/* Header */}
      <Box sx={{ mb: 4 }}>
        <Typography
          variant="h4"
          component="h1"
          sx={{ fontWeight: 700, color: 'text.primary', mb: 1 }}
        >
          Settings
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Manage your API keys and notification settings
        </Typography>
      </Box>

      {/* Settings Grid */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            md: 'repeat(2, 1fr)',
            lg: 'repeat(3, 1fr)',
          },
          gap: 3,
        }}
      >
        {/* API Keys Section */}
        <ApiKeyCard
          apiKeys={apiKeys.apiKeys}
          error={apiKeys.error}
          createdToken={apiKeys.createdToken}
          onCreateClick={() => apiKeys.setCreateDialogOpen(true)}
          onDeleteClick={apiKeys.openDeleteDialog}
          onClearCreatedToken={apiKeys.clearCreatedToken}
          onCopyToClipboard={apiKeys.copyToClipboard}
        />

        {/* Alert Filters Section */}
        <SettingsSectionCard
          title="Alert Filters"
          icon={<AlertFiltersIcon />}
          color={SECTION_COLORS['alert-filters']}
          href="/settings/alert-filters"
          description="Configure which alerts to omit or use to abort test runs"
        />

        {/* General Settings Section */}
        <SettingsSectionCard
          title="General Settings"
          icon={<Settings />}
          color={SECTION_COLORS.general}
          comingSoon
        />

        {/* Notifications Section */}
        <SettingsSectionCard
          title="Notifications"
          icon={<NotificationsIcon />}
          color={SECTION_COLORS.notifications}
          comingSoon
        />
      </Box>

      {/* Create API Key Dialog */}
      <ApiKeyFormDialog
        open={apiKeys.createDialogOpen}
        form={apiKeys.form}
        organizations={apiKeys.organizations}
        onClose={apiKeys.closeDialogs}
        onSubmit={apiKeys.handleCreateKey}
      />

      {/* Delete API Key Dialog */}
      <ApiKeyDeleteDialog
        open={apiKeys.deleteDialogOpen}
        apiKey={apiKeys.selectedKey}
        onClose={() => apiKeys.setDeleteDialogOpen(false)}
        onConfirm={apiKeys.handleDeleteKey}
      />

      {/* Snackbar for notifications */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        message={snackbar.message}
      />
    </Box>
  );
}
