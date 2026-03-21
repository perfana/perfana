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
} from '@mui/material';
import { Groups } from '@mui/icons-material';
import { useCreateTeam } from '@/lib/hooks/use-teams';

interface CreateTeamDialogProps {
  open: boolean;
  onClose: () => void;
  organizationId: string;
  onSuccess?: () => void;
}

export function CreateTeamDialog({
  open,
  onClose,
  organizationId,
  onSuccess,
}: CreateTeamDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createTeam = useCreateTeam();

  const handleClose = () => {
    setName('');
    setDescription('');
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

    try {
      await createTeam.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        organization_id: organizationId,
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

          <TextField
            autoFocus
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
            disabled={createTeam.isPending || !name.trim()}
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
