'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Alert,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Box,
  Typography,
  Chip,
  Avatar,
} from '@mui/material';
import { Edit, Person } from '@mui/icons-material';
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
import type { MemberType } from './AddMemberDialog';

interface MemberInfo {
  id: string;
  user_id: string;
  user_name?: string;
  user_email?: string;
  roles: string[];
}

interface EditMemberRolesDialogProps {
  open: boolean;
  type: MemberType;
  member: MemberInfo | null;
  onClose: () => void;
  onSubmit: (membershipId: string, roles: string[]) => Promise<void>;
  isSubmitting?: boolean;
  error?: string | null;
}

/**
 * Dialog for editing the roles of an existing organization or team member.
 */
export function EditMemberRolesDialog({
  open,
  type,
  member,
  onClose,
  onSubmit,
  isSubmitting = false,
  error = null,
}: EditMemberRolesDialogProps) {
  const [selectedRole, setSelectedRole] = useState<string>('');
  const [localError, setLocalError] = useState<string | null>(null);

  const isOrganization = type === 'organization';
  const roles = isOrganization ? ALL_ORGANIZATION_ROLES : ALL_TEAM_ROLES;
  const getRoleLabel = isOrganization ? getOrganizationRoleLabel : getTeamRoleLabel;
  const getRoleColor = isOrganization ? getOrganizationRoleColor : getTeamRoleColor;

  // Initialize selected role when member changes
  useEffect(() => {
    if (member && member.roles.length > 0) {
      setSelectedRole(member.roles[0]);
    }
  }, [member]);

  const handleClose = () => {
    setSelectedRole('');
    setLocalError(null);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (!member) {
      setLocalError('No member selected');
      return;
    }

    if (!selectedRole) {
      setLocalError('Please select a role');
      return;
    }

    try {
      await onSubmit(member.id, [selectedRole]);
      handleClose();
    } catch (err) {
      // Error is handled by parent through error prop
    }
  };

  const displayError = error || localError;
  const themeColor = isOrganization ? 'rgba(25, 118, 210, 1)' : 'rgba(156, 39, 176, 1)';
  const themeDark = isOrganization ? 'rgba(21, 101, 192, 1)' : 'rgba(123, 31, 162, 1)';

  const displayName = member?.user_name || member?.user_email || member?.user_id || 'Unknown User';
  const currentRole = member?.roles[0] || '';

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
            <Edit />
          </Box>
          Edit Member Role
        </DialogTitle>
        <DialogContent>
          {displayError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {displayError}
            </Alert>
          )}

          {/* Member Info */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              p: 2,
              mb: 3,
              borderRadius: '8px',
              backgroundColor: 'rgba(0, 0, 0, 0.02)',
              border: '1px solid rgba(0, 0, 0, 0.08)',
            }}
          >
            <Avatar
              sx={{
                width: 48,
                height: 48,
                backgroundColor: themeColor.replace('1)', '0.1)'),
                color: themeColor,
              }}
            >
              <Person />
            </Avatar>
            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                {displayName}
              </Typography>
              {member?.user_email && member.user_email !== displayName && (
                <Typography variant="body2" color="text.secondary">
                  {member.user_email}
                </Typography>
              )}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                <Typography variant="caption" color="text.secondary">
                  Current role:
                </Typography>
                <Chip
                  label={getRoleLabel(currentRole)}
                  size="small"
                  color={getRoleColor(currentRole)}
                  sx={{ fontWeight: 500, height: 20, fontSize: '0.7rem' }}
                />
              </Box>
            </Box>
          </Box>

          <FormControl fullWidth variant="outlined">
            <InputLabel id="role-select-label">New Role</InputLabel>
            <Select
              labelId="role-select-label"
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
              label="New Role"
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
                    {role === currentRole && (
                      <Chip
                        label="Current"
                        size="small"
                        variant="outlined"
                        sx={{ ml: 'auto', height: 20, fontSize: '0.65rem' }}
                      />
                    )}
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {selectedRole && selectedRole !== currentRole && (
            <Alert severity="info" sx={{ mt: 2 }}>
              This will change the member&apos;s role from{' '}
              <strong>{getRoleLabel(currentRole)}</strong> to{' '}
              <strong>{getRoleLabel(selectedRole)}</strong>.
            </Alert>
          )}
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
            disabled={isSubmitting || selectedRole === currentRole}
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
            {isSubmitting ? 'Saving...' : 'Save Changes'}
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
