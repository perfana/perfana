'use client';

import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Alert,
  Box,
  Typography,
  Avatar,
} from '@mui/material';
import { PersonRemove, Person, Warning } from '@mui/icons-material';
import type { MemberType } from './AddMemberDialog';

interface MemberInfo {
  id: string;
  user_id: string;
  user_name?: string;
  user_email?: string;
  roles: string[];
}

interface RemoveMemberDialogProps {
  open: boolean;
  type: MemberType;
  member: MemberInfo | null;
  onClose: () => void;
  onConfirm: (membershipId: string) => Promise<void>;
  isSubmitting?: boolean;
  error?: string | null;
}

/**
 * Confirmation dialog for removing a member from an organization or team.
 */
export function RemoveMemberDialog({
  open,
  type,
  member,
  onClose,
  onConfirm,
  isSubmitting = false,
  error = null,
}: RemoveMemberDialogProps) {
  const isOrganization = type === 'organization';

  const handleConfirm = async () => {
    if (!member) return;

    try {
      await onConfirm(member.id);
      onClose();
    } catch (err) {
      // Error is handled by parent through error prop
    }
  };

  const displayName = member?.user_name || member?.user_email || member?.user_id || 'Unknown User';
  const entityName = isOrganization ? 'organization' : 'team';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: '12px',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.15)',
        },
      }}
    >
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
            background: 'linear-gradient(135deg, rgba(244, 67, 54, 0.1) 0%, rgba(244, 67, 54, 0.05) 100%)',
            color: 'error.main',
          }}
        >
          <PersonRemove />
        </Box>
        Remove Member
      </DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {/* Warning */}
        <Alert
          severity="warning"
          icon={<Warning />}
          sx={{ mb: 3 }}
        >
          This action cannot be undone. The member will lose access to this {entityName} immediately.
        </Alert>

        {/* Member Info */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            p: 2,
            borderRadius: '8px',
            backgroundColor: 'rgba(0, 0, 0, 0.02)',
            border: '1px solid rgba(0, 0, 0, 0.08)',
          }}
        >
          <Avatar
            sx={{
              width: 48,
              height: 48,
              backgroundColor: 'rgba(244, 67, 54, 0.1)',
              color: 'error.main',
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
          </Box>
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          Are you sure you want to remove <strong>{displayName}</strong> from this {entityName}?
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button
          onClick={onClose}
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
          onClick={handleConfirm}
          variant="contained"
          color="error"
          disabled={isSubmitting}
          sx={{
            textTransform: 'none',
            fontWeight: 600,
          }}
        >
          {isSubmitting ? 'Removing...' : 'Remove Member'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
