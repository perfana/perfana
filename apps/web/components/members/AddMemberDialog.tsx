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
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Box,
  Typography,
  Chip,
} from '@mui/material';
import { PersonAdd } from '@mui/icons-material';
import {
  OrganizationRole,
  TeamRole,
  ALL_ORGANIZATION_ROLES,
  ALL_TEAM_ROLES,
  getOrganizationRoleLabel,
  getTeamRoleLabel,
  getOrganizationRoleColor,
  getTeamRoleColor,
} from '@/lib/constants/roles';

export type MemberType = 'organization' | 'team';

interface AddMemberDialogProps {
  open: boolean;
  type: MemberType;
  onClose: () => void;
  onSubmit: (data: { user_id: string; roles: string[] }) => Promise<void>;
  isSubmitting?: boolean;
  error?: string | null;
}

/**
 * Dialog for adding a new member to an organization or team.
 * Supports role selection based on the member type.
 */
export function AddMemberDialog({
  open,
  type,
  onClose,
  onSubmit,
  isSubmitting = false,
  error = null,
}: AddMemberDialogProps) {
  const [userId, setUserId] = useState('');
  const [selectedRole, setSelectedRole] = useState<string>('');
  const [localError, setLocalError] = useState<string | null>(null);

  const isOrganization = type === 'organization';
  const roles = isOrganization ? ALL_ORGANIZATION_ROLES : ALL_TEAM_ROLES;
  const defaultRole = isOrganization ? OrganizationRole.MEMBER : TeamRole.MEMBER;
  const getRoleLabel = isOrganization ? getOrganizationRoleLabel : getTeamRoleLabel;
  const getRoleColor = isOrganization ? getOrganizationRoleColor : getTeamRoleColor;

  const handleClose = () => {
    setUserId('');
    setSelectedRole('');
    setLocalError(null);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (!userId.trim()) {
      setLocalError('User ID is required');
      return;
    }

    const roleToSubmit = selectedRole || defaultRole;

    try {
      await onSubmit({
        user_id: userId.trim(),
        roles: [roleToSubmit],
      });
      handleClose();
    } catch (err) {
      // Error is handled by parent through error prop
    }
  };

  const displayError = error || localError;
  const themeColor = isOrganization ? 'rgba(25, 118, 210, 1)' : 'rgba(156, 39, 176, 1)';
  const themeDark = isOrganization ? 'rgba(21, 101, 192, 1)' : 'rgba(123, 31, 162, 1)';

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
        <DialogTitle
          sx={{
            fontWeight: 600,
            fontSize: '1.25rem',
            pb: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
          }}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 40,
              height: 40,
              borderRadius: '8px',
              background: `linear-gradient(135deg, ${themeColor.replace('1)', '0.1)')} 0%, ${themeColor.replace('1)', '0.05)')} 100%)`,
              color: themeColor,
            }}
          >
            <PersonAdd />
          </Box>
          Add {isOrganization ? 'Organization' : 'Team'} Member
        </DialogTitle>
        <DialogContent>
          {displayError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {displayError}
            </Alert>
          )}

          <Box sx={{ mb: 3 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Add a new member to this {isOrganization ? 'organization' : 'team'} by entering their
              user ID and selecting a role.
            </Typography>
          </Box>

          <TextField
            autoFocus
            margin="dense"
            label="User ID"
            placeholder="Enter the user's Keycloak ID or email"
            fullWidth
            variant="outlined"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            error={!!localError && !userId.trim()}
            helperText={!userId.trim() && localError ? 'User ID is required' : ''}
            sx={{ mb: 3 }}
            disabled={isSubmitting}
          />

          <FormControl fullWidth variant="outlined">
            <InputLabel id="role-select-label">Role</InputLabel>
            <Select
              labelId="role-select-label"
              value={selectedRole || defaultRole}
              onChange={(e) => setSelectedRole(e.target.value)}
              label="Role"
              disabled={isSubmitting}
              renderValue={(selected) => (
                <Chip
                  label={getRoleLabel(selected)}
                  size="small"
                  color={getRoleColor(selected)}
                  sx={{ fontWeight: 500 }}
                />
              )}
            >
              {roles.map((role) => (
                <MenuItem key={role} value={role}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Chip
                      label={getRoleLabel(role)}
                      size="small"
                      color={getRoleColor(role)}
                      sx={{ fontWeight: 500, minWidth: 70 }}
                    />
                    <Typography variant="body2" color="text.secondary">
                      {getRoleDescription(role, type)}
                    </Typography>
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button
            onClick={handleClose}
            disabled={isSubmitting}
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
            disabled={isSubmitting}
            sx={{
              background: `linear-gradient(135deg, ${themeColor} 0%, ${themeColor.replace('1)', '0.85)')} 100%)`,
              boxShadow: `0 2px 8px ${themeColor.replace('1)', '0.3)')}`,
              textTransform: 'none',
              fontWeight: 600,
              '&:hover': {
                background: `linear-gradient(135deg, ${themeDark} 0%, ${themeColor} 100%)`,
                boxShadow: `0 4px 12px ${themeColor.replace('1)', '0.4)')}`,
              },
              '&:disabled': {
                background: 'rgba(0, 0, 0, 0.12)',
              },
            }}
          >
            {isSubmitting ? 'Adding...' : 'Add Member'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

/**
 * Get description text for each role.
 */
function getRoleDescription(role: string, type: MemberType): string {
  if (type === 'organization') {
    const descriptions: Record<string, string> = {
      [OrganizationRole.ADMIN]: 'Full control over organization',
      [OrganizationRole.MEMBER]: 'View and use resources',
      [OrganizationRole.VIEWER]: 'View-only access',
    };
    return descriptions[role] || '';
  } else {
    const descriptions: Record<string, string> = {
      [TeamRole.ADMIN]: 'Full control over team',
      [TeamRole.MEMBER]: 'Contribute to team',
      [TeamRole.VIEWER]: 'View-only access',
    };
    return descriptions[role] || '';
  }
}
