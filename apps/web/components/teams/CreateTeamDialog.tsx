'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Alert,
  Box,
  Typography,
  MenuItem,
} from '@mui/material';
import { Groups } from '@mui/icons-material';
import { useCreateTeam } from '@/lib/hooks/use-teams';

interface CreateTeamDialogProps {
  open: boolean;
  onClose: () => void;
  /**
   * The organization to create in, when it is unambiguous — a selected filter, or the
   * single organization the user belongs to. Pass `null` when it is NOT, and give
   * `organizations` instead: the dialog then asks rather than guessing.
   */
  organizationId: string | null;
  /**
   * Candidates, used only when `organizationId` is null. The page used to resolve that
   * case with `organizations[0].id` — which is exactly the state `organization-context`
   * leaves a multi-organization user in, so a team was silently created in whichever
   * organization happened to sort first.
   */
  organizations?: Array<{ id: string; name: string }>;
  onSuccess?: () => void;
}

export function CreateTeamDialog({
  open,
  onClose,
  organizationId,
  organizations = [],
  onSuccess,
}: CreateTeamDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Deliberately NOT defaulted to organizations[0]: an unset Select shows its label and
  // the submit button stays disabled, so the user has to make the choice. Defaulting it
  // would reintroduce the silent first-row pick behind a control that looks deliberate.
  const [pickedOrgId, setPickedOrgId] = useState('');

  const mustPick = !organizationId;
  const targetOrgId = organizationId ?? pickedOrgId;

  const createTeam = useCreateTeam();

  const handleClose = () => {
    setName('');
    setDescription('');
    setPickedOrgId('');
    setError(null);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Team name is required');
      return;
    }

    if (!targetOrgId) {
      setError('Select an organization');
      return;
    }

    try {
      await createTeam.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        organization_id: targetOrgId,
      });
      handleClose();
      onSuccess?.();
    } catch (err) {
      setError(
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to create team'
      );
    }
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: '12px',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.15)',
        },
      }}
    >
      <form onSubmit={handleSubmit}>
        <DialogTitle sx={{ fontWeight: 600, fontSize: '1.25rem', pb: 1 }}>
          <Box display="flex" alignItems="center" gap={1.5}>
            <Box
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 40,
                height: 40,
                borderRadius: '8px',
                background:
                  'linear-gradient(135deg, rgba(25, 118, 210, 0.1) 0%, rgba(25, 118, 210, 0.05) 100%)',
                color: 'primary.main',
              }}
            >
              <Groups />
            </Box>
            <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
              Create New Team
            </Typography>
          </Box>
        </DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {mustPick && (
            <TextField
              select
              autoFocus
              margin="dense"
              label="Organization"
              fullWidth
              variant="outlined"
              value={pickedOrgId}
              onChange={(e) => setPickedOrgId(e.target.value)}
              required
              helperText="You belong to more than one organization — choose where this team lives."
              sx={{ mb: 2 }}
            >
              {organizations.map((org) => (
                <MenuItem key={org.id} value={org.id}>
                  {org.name}
                </MenuItem>
              ))}
            </TextField>
          )}

          <TextField
            autoFocus={!mustPick}
            margin="dense"
            label="Team Name"
            placeholder="e.g., Backend Team, QA Engineers"
            fullWidth
            variant="outlined"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            error={!!error && !name.trim()}
            helperText={!name.trim() && error ? 'Name is required' : ''}
            sx={{ mb: 2 }}
          />

          <TextField
            margin="dense"
            label="Description (optional)"
            placeholder="Brief description of the team"
            fullWidth
            variant="outlined"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            multiline
            rows={3}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button
            onClick={handleClose}
            disabled={createTeam.isPending}
            sx={{
              textTransform: 'none',
              fontWeight: 600,
              color: 'text.secondary',
            }}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={createTeam.isPending || !name.trim() || !targetOrgId}
            sx={{
              background:
                'linear-gradient(135deg, rgba(25, 118, 210, 1) 0%, rgba(30, 136, 229, 1) 100%)',
              boxShadow: '0 2px 8px rgba(25, 118, 210, 0.3)',
              textTransform: 'none',
              fontWeight: 600,
              '&:hover': {
                background:
                  'linear-gradient(135deg, rgba(21, 101, 192, 1) 0%, rgba(25, 118, 210, 1) 100%)',
                boxShadow: '0 4px 12px rgba(25, 118, 210, 0.4)',
              },
              '&:disabled': {
                background: 'rgba(0, 0, 0, 0.12)',
              },
            }}
          >
            {createTeam.isPending ? 'Creating...' : 'Create Team'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
