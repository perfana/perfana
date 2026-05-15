'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Alert,
  Box,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Checkbox,
  ListItemText,
  OutlinedInput,
  Typography,
  Chip,
} from '@mui/material';
import { Person as PersonIcon } from '@mui/icons-material';
import {
  useAddOrganizationMember,
} from '@/lib/hooks/use-organization-members';
import { useAddTeamMember } from '@/lib/hooks/use-team-members';
import {
  ORGANIZATION_ROLES,
  TEAM_ROLES,
  ORGANIZATION_ROLE_LABELS,
  TEAM_ROLE_LABELS,
} from '@/lib/constants/roles';
import { UserSearchSelect } from '@/components/users/UserSearchSelect';
import { UserInfo } from '@/lib/api/users';

interface AddMemberDialogProps {
  open: boolean;
  onClose: () => void;
  organizationId?: string;
  teamId?: string;
  memberType: 'organization' | 'team';
  existingMemberIds?: string[]; // User IDs of existing members to exclude from search
  onSuccess?: () => void;
}

export function AddMemberDialog({
  open,
  onClose,
  organizationId,
  teamId,
  memberType,
  existingMemberIds = [],
  onSuccess,
}: AddMemberDialogProps) {
  const [selectedUser, setSelectedUser] = useState<UserInfo | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const addOrgMember = useAddOrganizationMember();
  const addTeamMember = useAddTeamMember();

  const roles = memberType === 'organization' ? ORGANIZATION_ROLES : TEAM_ROLES;
  const roleLabels =
    memberType === 'organization'
      ? ORGANIZATION_ROLE_LABELS
      : TEAM_ROLE_LABELS;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!selectedUser) {
      setError('Please select a user');
      return;
    }

    if (selectedRoles.length === 0) {
      setError('At least one role is required');
      return;
    }

    try {
      if (memberType === 'organization' && organizationId) {
        await addOrgMember.mutateAsync({
          organizationId,
          dto: {
            userId: selectedUser.id,
            roles: selectedRoles,
          },
        });
      } else if (memberType === 'team' && teamId) {
        await addTeamMember.mutateAsync({
          teamId,
          dto: {
            userId: selectedUser.id,
            roles: selectedRoles,
          },
        });
      }

      // Reset form
      setSelectedUser(null);
      setSelectedRoles([]);
      onSuccess?.();
      onClose();
    } catch (err) {
      const errorMessage =
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to add member';
      setError(errorMessage);
    }
  };

  const handleClose = () => {
    setError(null);
    setSelectedUser(null);
    setSelectedRoles([]);
    onClose();
  };

  const isPending =
    memberType === 'organization'
      ? addOrgMember.isPending
      : addTeamMember.isPending;

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
              <PersonIcon />
            </Box>
            <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
              Add {memberType === 'organization' ? 'Organization' : 'Team'} Member
            </Typography>
          </Box>
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}

            {/* Selected user display */}
            {selectedUser && (
              <Box
                sx={{
                  p: 2,
                  border: '2px solid',
                  borderColor: 'primary.main',
                  borderRadius: 1,
                  bgcolor: 'primary.light',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                }}
              >
                <PersonIcon color="primary" />
                <Box sx={{ flex: 1 }}>
                  <Typography variant="subtitle1" fontWeight="bold">
                    {selectedUser.displayName}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {selectedUser.email || selectedUser.username}
                  </Typography>
                </Box>
                <Chip
                  label="Selected"
                  color="primary"
                  size="small"
                />
              </Box>
            )}

            {/* User search */}
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                {selectedUser ? 'Change User' : 'Select User'}
              </Typography>
              <UserSearchSelect
                onSelect={setSelectedUser}
                selectedUserId={selectedUser?.id}
                excludeUserIds={existingMemberIds}
                placeholder="Search by name, email, or username..."
              />
            </Box>

            {/* Role selection */}
            <FormControl fullWidth required>
              <InputLabel id="roles-label">Roles</InputLabel>
              <Select
                labelId="roles-label"
                multiple
                value={selectedRoles}
                onChange={(e) =>
                  setSelectedRoles(
                    typeof e.target.value === 'string'
                      ? e.target.value.split(',')
                      : e.target.value
                  )
                }
                input={<OutlinedInput label="Roles" />}
                renderValue={(selected) =>
                  selected
                    .map((role) => roleLabels[role as keyof typeof roleLabels] || role)
                    .join(', ')
                }
              >
                {roles.map((role) => (
                  <MenuItem key={role} value={role}>
                    <Checkbox checked={selectedRoles.indexOf(role) > -1} />
                    <ListItemText
                      primary={roleLabels[role as keyof typeof roleLabels]}
                    />
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={handleClose}
            disabled={isPending}
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
            disabled={isPending || !selectedUser || selectedRoles.length === 0}
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
            {isPending ? 'Adding...' : 'Add Member'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
