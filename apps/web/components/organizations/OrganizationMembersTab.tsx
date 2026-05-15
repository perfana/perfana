'use client';

import { useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Tooltip,
  Chip,
  CircularProgress,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
} from '@mui/material';
import { Add, Edit, Delete } from '@mui/icons-material';
import {
  useOrganizationMembers,
  useRemoveOrganizationMember,
} from '@/lib/hooks/use-organization-members';
import { OrganizationMember } from '@/lib/api/organization-members';
import {
  getOrganizationRoleLabel,
} from '@/lib/constants/roles';
import { AddMemberDialog } from './AddMemberDialog';
import { EditMemberRolesDialog } from './EditMemberRolesDialog';

interface OrganizationMembersTabProps {
  organizationId: string;
}

export function OrganizationMembersTab({
  organizationId,
}: OrganizationMembersTabProps) {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedMember, setSelectedMember] =
    useState<OrganizationMember | null>(null);

  const { data: members = [], isLoading, error } = useOrganizationMembers(organizationId);
  const removeMemberMutation = useRemoveOrganizationMember();

  const handleEditClick = (member: OrganizationMember) => {
    setSelectedMember(member);
    setEditDialogOpen(true);
  };

  const handleDeleteClick = (member: OrganizationMember) => {
    setSelectedMember(member);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!selectedMember) return;

    try {
      await removeMemberMutation.mutateAsync({
        id: selectedMember.id,
        organizationId: selectedMember.organization_id,
      });
      setDeleteDialogOpen(false);
      setSelectedMember(null);
    } catch (err) {
      console.error('Failed to remove member:', err);
      // Error is handled by the mutation hook and displayed in the UI
    }
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'N/A';
    return date.toLocaleDateString();
  };

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" py={4}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ mt: 2 }}>
        Failed to load members:{' '}
        {error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Unknown error'}
      </Alert>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Box
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        mb={3}
      >
        <Typography variant="h6">Members ({members.length})</Typography>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => setAddDialogOpen(true)}
          sx={{ textTransform: 'none' }}
        >
          Add Member
        </Button>
      </Box>

      {/* Members table */}
      {members.length === 0 ? (
        <Box textAlign="center" py={6}>
          <Typography variant="h6" color="text.secondary" gutterBottom>
            No Members Yet
          </Typography>
          <Typography variant="body2" color="text.secondary" mb={3}>
            Add members to this organization to collaborate on projects.
          </Typography>
          <Button
            variant="outlined"
            startIcon={<Add />}
            onClick={() => setAddDialogOpen(true)}
            sx={{ textTransform: 'none' }}
          >
            Add First Member
          </Button>
        </Box>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>User</TableCell>
                <TableCell>Roles</TableCell>
                <TableCell>Added</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.id} hover>
                  <TableCell>
                    <Box>
                      <Typography variant="body2" fontWeight={500}>
                        {member.userInfo?.displayName || member.user_id}
                      </Typography>
                      {member.userInfo?.email && (
                        <Typography variant="caption" color="text.secondary">
                          {member.userInfo.email}
                        </Typography>
                      )}
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Box display="flex" gap={0.5} flexWrap="wrap">
                      {member.roles.map((role) => (
                        <Chip
                          key={role}
                          label={getOrganizationRoleLabel(role)}
                          size="small"
                          color={
                            role.includes('owner')
                              ? 'primary'
                              : role.includes('admin')
                              ? 'secondary'
                              : 'default'
                          }
                        />
                      ))}
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {formatDate(member.created_at)}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Edit Roles">
                      <IconButton
                        size="small"
                        onClick={() => handleEditClick(member)}
                      >
                        <Edit fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Remove Member">
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => handleDeleteClick(member)}
                      >
                        <Delete fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Add Member Dialog */}
      <AddMemberDialog
        open={addDialogOpen}
        onClose={() => setAddDialogOpen(false)}
        organizationId={organizationId}
        memberType="organization"
        existingMemberIds={members.map((m) => m.user_id)}
      />

      {/* Edit Roles Dialog */}
      {selectedMember && (
        <EditMemberRolesDialog
          open={editDialogOpen}
          onClose={() => {
            setEditDialogOpen(false);
            setSelectedMember(null);
          }}
          member={selectedMember}
          memberType="organization"
        />
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => {
          if (!removeMemberMutation.isPending) {
            setDeleteDialogOpen(false);
            setSelectedMember(null);
          }
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Remove Member</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to remove{' '}
            <strong>
              {selectedMember?.userInfo?.displayName || selectedMember?.user_id}
            </strong>{' '}
            from this organization? They will lose all access to organization
            resources.
          </DialogContentText>
          {removeMemberMutation.isError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {removeMemberMutation.error &&
              typeof removeMemberMutation.error === 'object' &&
              'message' in removeMemberMutation.error
                ? (removeMemberMutation.error as Error).message
                : 'Failed to remove member'}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setDeleteDialogOpen(false);
              setSelectedMember(null);
            }}
            disabled={removeMemberMutation.isPending}
            sx={{ textTransform: 'none' }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleDeleteConfirm}
            color="error"
            variant="contained"
            disabled={removeMemberMutation.isPending}
            sx={{ textTransform: 'none' }}
          >
            {removeMemberMutation.isPending ? (
              <>
                <CircularProgress size={16} sx={{ mr: 1 }} />
                Removing...
              </>
            ) : (
              'Remove Member'
            )}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
