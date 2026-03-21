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
  Switch,
  FormControlLabel,
} from '@mui/material';
import { Save, Delete } from '@mui/icons-material';
import { Team } from '@/lib/api/teams';
import { useUpdateTeam, useDeleteTeam } from '@/lib/hooks/use-teams';

interface TeamSettingsTabProps {
  team: Team;
  onDeleted?: () => void;
}

export function TeamSettingsTab({ team, onDeleted }: TeamSettingsTabProps) {
  const [name, setName] = useState(team.name);
  const [description, setDescription] = useState(team.description || '');
  const [restrictAccess, setRestrictAccess] = useState(team.restrict_to_team_members ?? false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const updateTeam = useUpdateTeam();
  const deleteTeam = useDeleteTeam();

  // Update local state when team changes
  useEffect(() => {
    setName(team.name);
    setDescription(team.description || '');
    setRestrictAccess(team.restrict_to_team_members ?? false);
  }, [team]);

  const handleSave = async () => {
    setError(null);
    setSuccess(null);

    if (!name.trim()) {
      setError('Team name is required');
      return;
    }

    try {
      await updateTeam.mutateAsync({
        id: team.id,
        dto: {
          name: name.trim(),
          description: description.trim() || undefined,
          restrict_to_team_members: restrictAccess,
        },
      });
      setSuccess('Team updated successfully');
    } catch (err) {
      const errorMessage =
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to update team';
      setError(errorMessage);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteTeam.mutateAsync(team.id);
      setDeleteDialogOpen(false);
      onDeleted?.();
    } catch (err) {
      const errorMessage =
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to delete team';
      setError(errorMessage);
      setDeleteDialogOpen(false);
    }
  };

  const hasChanges =
    name !== team.name ||
    description !== (team.description || '') ||
    restrictAccess !== (team.restrict_to_team_members ?? false);

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
          label="Team Name"
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
            disabled={updateTeam.isPending || !hasChanges}
            sx={{ textTransform: 'none' }}
          >
            {updateTeam.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </Box>
      </Box>

      <Divider sx={{ my: 4 }} />

      {/* Access Settings */}
      <Typography variant="h6" gutterBottom>
        Access Settings
      </Typography>
      <Box sx={{ mb: 4, maxWidth: 600 }}>
        <FormControlLabel
          control={
            <Switch
              checked={restrictAccess}
              onChange={(e) => setRestrictAccess(e.target.checked)}
            />
          }
          label="Restrict access to team members only"
        />
        <Typography variant="body2" color="text.secondary" sx={{ ml: 4.5 }}>
          When enabled, only team members can view test run results for systems
          belonging to this team. When disabled, all organization members can
          view them.
        </Typography>
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
          Delete Team
        </Typography>
        <Typography variant="body2" color="text.secondary" mb={2}>
          Once you delete a team, there is no going back. This will permanently
          delete the team and remove all member associations.
        </Typography>
        <Button
          variant="outlined"
          color="error"
          startIcon={<Delete />}
          onClick={() => setDeleteDialogOpen(true)}
          sx={{ textTransform: 'none' }}
        >
          Delete Team
        </Button>
      </Box>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
      >
        <DialogTitle>Delete Team?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete &ldquo;{team.name}&rdquo;? This
            action cannot be undone and will remove all member associations.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={handleDelete}
            color="error"
            variant="contained"
            disabled={deleteTeam.isPending}
          >
            {deleteTeam.isPending ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
