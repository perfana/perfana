'use client';

import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Alert,
  Divider,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
} from '@mui/material';
import { Save, Delete } from '@mui/icons-material';
import { Organization } from '@/lib/api/organizations';
import {
  useUpdateOrganization,
  useDeleteOrganization,
} from '@/lib/hooks/use-organizations';

interface OrganizationSettingsTabProps {
  organization: Organization;
  onDeleted?: () => void;
}

export function OrganizationSettingsTab({
  organization,
  onDeleted,
}: OrganizationSettingsTabProps) {
  const [name, setName] = useState(organization.name);
  const [description, setDescription] = useState(organization.description || '');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const updateOrganization = useUpdateOrganization();
  const deleteOrganization = useDeleteOrganization();

  // Update local state when organization changes
  useEffect(() => {
    setName(organization.name);
    setDescription(organization.description || '');
  }, [organization]);

  const handleSave = async () => {
    setError(null);
    setSuccess(null);

    if (!name.trim()) {
      setError('Organization name is required');
      return;
    }

    try {
      await updateOrganization.mutateAsync({
        id: organization.id,
        dto: {
          name: name.trim(),
          description: description.trim() || undefined,
        },
      });
      setSuccess('Organization updated successfully');
    } catch (err) {
      const errorMessage =
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to update organization';
      setError(errorMessage);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteOrganization.mutateAsync(organization.id);
      setDeleteDialogOpen(false);
      onDeleted?.();
    } catch (err) {
      const errorMessage =
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to delete organization';
      setError(errorMessage);
      setDeleteDialogOpen(false);
    }
  };

  const hasChanges =
    name !== organization.name ||
    description !== (organization.description || '');

  return (
    <Box>
      {/* Error/Success alerts */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert
          severity="success"
          sx={{ mb: 3 }}
          onClose={() => setSuccess(null)}
        >
          {success}
        </Alert>
      )}

      {/* Basic Information */}
      <Typography variant="h6" gutterBottom>
        Basic Information
      </Typography>
      <Box
        sx={{ display: 'flex', flexDirection: 'column', gap: 2, mb: 4, maxWidth: 600 }}
      >
        <TextField
          label="Organization Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          fullWidth
        />
        <TextField
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          fullWidth
          multiline
          rows={3}
        />
        <Box>
          <Button
            variant="contained"
            startIcon={<Save />}
            onClick={handleSave}
            disabled={updateOrganization.isPending || !hasChanges}
            sx={{ textTransform: 'none' }}
          >
            {updateOrganization.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </Box>
      </Box>

      <Divider sx={{ my: 4 }} />

      {/* Danger Zone */}
      <Typography variant="h6" gutterBottom color="error">
        Danger Zone
      </Typography>
      <Box
        sx={{
          p: 3,
          border: '1px solid',
          borderColor: 'error.light',
          borderRadius: 1,
          maxWidth: 600,
        }}
      >
        <Typography variant="subtitle1" fontWeight={500} gutterBottom>
          Delete Organization
        </Typography>
        <Typography variant="body2" color="text.secondary" mb={2}>
          Once you delete an organization, there is no going back. This will
          permanently delete the organization and all associated teams and
          resources.
        </Typography>
        <Button
          variant="outlined"
          color="error"
          startIcon={<Delete />}
          onClick={() => setDeleteDialogOpen(true)}
          sx={{ textTransform: 'none' }}
        >
          Delete Organization
        </Button>
      </Box>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
      >
        <DialogTitle>Delete Organization?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete &ldquo;{organization.name}&rdquo;?
            This action cannot be undone and will permanently delete all
            associated teams and resources.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={handleDelete}
            color="error"
            variant="contained"
            disabled={deleteOrganization.isPending}
          >
            {deleteOrganization.isPending ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
