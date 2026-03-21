'use client';

import { useState, useEffect } from 'react';
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
} from '@mui/material';
import { Edit as EditIcon } from '@mui/icons-material';
import { useUpdateOrganizationMemberRoles } from '@/lib/hooks/use-organization-members';
import { useUpdateTeamMemberRoles } from '@/lib/hooks/use-team-members';
import { OrganizationMember } from '@/lib/api/organization-members';
import { TeamMember } from '@/lib/api/team-members';
import {
  ORGANIZATION_ROLES,
  TEAM_ROLES,
  ORGANIZATION_ROLE_LABELS,
  TEAM_ROLE_LABELS,
} from '@/lib/constants/roles';

interface EditMemberRolesDialogProps {
  open: boolean;
  onClose: () => void;
  member: OrganizationMember | TeamMember;
  memberType: 'organization' | 'team';
  onSuccess?: () => void;
}

export function EditMemberRolesDialog({
  open,
  onClose,
  member,
  memberType,
  onSuccess,
}: EditMemberRolesDialogProps) {
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const updateOrgMemberRoles = useUpdateOrganizationMemberRoles();
  const updateTeamMemberRoles = useUpdateTeamMemberRoles();

  const roles = memberType === 'organization' ? ORGANIZATION_ROLES : TEAM_ROLES;
  const roleLabels =
    memberType === 'organization'
      ? ORGANIZATION_ROLE_LABELS
      : TEAM_ROLE_LABELS;

  // Initialize with member's current roles
  useEffect(() => {
    if (member) {
      setSelectedRoles([...member.roles]);
    }
  }, [member]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (selectedRoles.length === 0) {
      setError('At least one role is required');
      return;
    }

    try {
      if (memberType === 'organization') {
        await updateOrgMemberRoles.mutateAsync({
          id: member.id,
          dto: { roles: selectedRoles },
        });
      } else {
        await updateTeamMemberRoles.mutateAsync({
          id: member.id,
          dto: { roles: selectedRoles },
        });
      }

      onSuccess?.();
      onClose();
    } catch (err) {
      const errorMessage =
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to update roles';
      setError(errorMessage);
    }
  };

  const handleClose = () => {
    setError(null);
    setSelectedRoles([...member.roles]);
    onClose();
  };

  const isPending =
    memberType === 'organization'
      ? updateOrgMemberRoles.isPending
      : updateTeamMemberRoles.isPending;

  const hasChanges =
    selectedRoles.length !== member.roles.length ||
    selectedRoles.some((r) => !member.roles.includes(r));

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
              <EditIcon />
            </Box>
            <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
              Edit Member Roles
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
            <Box>
              <Typography variant="body2" color="text.secondary">
                User
              </Typography>
              <Typography variant="body1" fontWeight={600}>
                {member.userInfo?.displayName || member.user_id}
              </Typography>
              {member.userInfo?.email && (
                <Typography variant="body2" color="text.secondary">
                  {member.userInfo.email}
                </Typography>
              )}
            </Box>
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
                    .map(
                      (role) => roleLabels[role as keyof typeof roleLabels] || role
                    )
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
            disabled={isPending || selectedRoles.length === 0 || !hasChanges}
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
            {isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
