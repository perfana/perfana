'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Box,
  Typography,
  Card,
  CardContent,
  CircularProgress,
  Alert,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
} from '@mui/material';
import {
  Tune,
  Lock,
  Add,
} from '@mui/icons-material';
import { fetchProfiles, createProfile, Profile } from '@/lib/profiles';
import { useOrganizationContext } from '@/lib/contexts/organization-context';

/**
 * Filters out system tags that should not be displayed to users
 */
function filterSystemTags(tags: string[] | undefined): string[] {
  if (!tags) return [];
  return tags.filter(tag => tag !== 'perfana' && tag !== 'perfana-template' && tag !== 'no-anomaly-detection');
}

export default function ProfilesPage() {
  const router = useRouter();
  const { currentOrganizationId } = useOrganizationContext();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfileDescription, setNewProfileDescription] = useState('');
  const [creating, setCreating] = useState(false);

  const loadProfiles = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchProfiles(currentOrganizationId || undefined);
      setProfiles(data);
      setError('');
    } catch (err) {
      setError(
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to load profiles'
      );
    } finally {
      setLoading(false);
    }
  }, [currentOrganizationId]);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  const handleCreateProfile = async () => {
    if (!newProfileName.trim()) return;
    try {
      setCreating(true);
      await createProfile({
        name: newProfileName.trim(),
        description: newProfileDescription.trim() || undefined,
      });
      setCreateDialogOpen(false);
      setNewProfileName('');
      setNewProfileDescription('');
      await loadProfiles();
    } catch (err) {
      setError(
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to create profile'
      );
    } finally {
      setCreating(false);
    }
  };

  const _formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress size={40} />
      </Box>
    );
  }

  return (
    <Box>
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={3}>
        <Box display="flex" alignItems="center" gap={2}>
          <Tune sx={{ fontSize: 32, color: 'primary.main' }} />
          <Typography variant="h4" component="h1">
            Profiles
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => setCreateDialogOpen(true)}
        >
          Add Profile
        </Button>
      </Box>

      <Dialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Create New Profile</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Profile Name"
            fullWidth
            required
            value={newProfileName}
            onChange={(e) => setNewProfileName(e.target.value)}
            sx={{ mt: 1 }}
          />
          <TextField
            margin="dense"
            label="Description"
            fullWidth
            multiline
            rows={3}
            value={newProfileDescription}
            onChange={(e) => setNewProfileDescription(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={handleCreateProfile}
            variant="contained"
            disabled={!newProfileName.trim() || creating}
          >
            {creating ? 'Creating...' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      <Card>
        <CardContent>
          {profiles.length === 0 ? (
            <Box textAlign="center" py={6}>
              <Tune sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
              <Typography variant="h6" color="text.secondary" gutterBottom>
                No profiles found
              </Typography>
              <Typography variant="body2" color="text.secondary">
                There are currently no profiles in the system.
              </Typography>
            </Box>
          ) : (
            <TableContainer component={Paper} variant="outlined">
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>
                      <Typography variant="subtitle2" fontWeight={600}>
                        Name
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="subtitle2" fontWeight={600}>
                        Description
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="subtitle2" fontWeight={600}>
                        Tags
                      </Typography>
                    </TableCell>
                    <TableCell align="center">
                      <Typography variant="subtitle2" fontWeight={600}>
                        Dashboards
                      </Typography>
                    </TableCell>
                    <TableCell align="center">
                      <Typography variant="subtitle2" fontWeight={600}>
                        SLOs
                      </Typography>
                    </TableCell>
                    <TableCell align="center">
                      <Typography variant="subtitle2" fontWeight={600}>
                        Deep Links
                      </Typography>
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {profiles.map((profile) => (
                    <TableRow
                      key={profile.id}
                      hover
                      onClick={() => router.push(`/settings/profiles/${profile.id}`)}
                      sx={{
                        '&:last-child td, &:last-child th': { border: 0 },
                        cursor: 'pointer',
                        transition: 'background-color 0.2s ease',
                        '&:hover': {
                          backgroundColor: 'rgba(25, 118, 210, 0.04)',
                        },
                      }}
                    >
                      <TableCell>
                        <Box display="flex" alignItems="center" gap={1}>
                          <Tune color="primary" fontSize="small" />
                          <Typography variant="body2" fontWeight={500}>
                            {profile.name}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{
                            maxWidth: 300,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {profile.description || '-'}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Box display="flex" gap={0.5} flexWrap="wrap">
                          {profile.readOnly && (
                            <Chip
                              icon={<Lock fontSize="small" />}
                              label="Provisioned"
                              size="small"
                              sx={{
                                height: '28px',
                                background: (theme) =>
                                  theme.palette.mode === 'dark'
                                    ? 'linear-gradient(135deg, rgba(255, 213, 79, 0.15) 0%, rgba(255, 193, 7, 0.20) 100%)'
                                    : 'linear-gradient(135deg, rgba(255, 193, 7, 0.1) 0%, rgba(255, 193, 7, 0.2) 100%)',
                                border: (theme) =>
                                  theme.palette.mode === 'dark'
                                    ? '1px solid rgba(255, 213, 79, 0.4)'
                                    : '1px solid rgba(255, 193, 7, 0.3)',
                                color: (theme) =>
                                  theme.palette.mode === 'dark' ? '#ffd54f' : '#f57f17',
                                fontWeight: 600,
                                backdropFilter: 'blur(8px)',
                                transition: 'all 0.2s ease',
                                '& .MuiChip-icon': {
                                  color: 'rgba(255, 193, 7, 0.7)',
                                  marginLeft: '4px'
                                },
                                '&:hover': {
                                  transform: 'translateY(-1px)',
                                  boxShadow: '0 4px 12px rgba(255, 193, 7, 0.3)',
                                  borderColor: 'rgba(255, 193, 7, 0.5)',
                                  '& .MuiChip-icon': {
                                    color: 'rgba(255, 193, 7, 1)'
                                  }
                                },
                                '& .MuiChip-label': {
                                  px: 1.5,
                                  py: 0,
                                  fontSize: '0.75rem'
                                }
                              }}
                            />
                          )}
                          {(() => {
                            const filteredTags = filterSystemTags(profile.tags);
                            return filteredTags.length > 0 ? (
                              filteredTags.map((tag, index) => (
                                <Chip
                                  key={index}
                                  label={tag}
                                  size="small"
                                  sx={{
                                    height: '28px',
                                    background: (theme) =>
                                      theme.palette.mode === 'dark'
                                        ? 'linear-gradient(135deg, rgba(100, 181, 246, 0.15) 0%, rgba(66, 165, 245, 0.20) 100%)'
                                        : 'linear-gradient(135deg, rgba(25, 118, 210, 0.1) 0%, rgba(25, 118, 210, 0.2) 100%)',
                                    border: (theme) =>
                                      theme.palette.mode === 'dark'
                                        ? '1px solid rgba(100, 181, 246, 0.4)'
                                        : '1px solid rgba(25, 118, 210, 0.3)',
                                    color: (theme) =>
                                      theme.palette.mode === 'dark' ? '#90caf9' : theme.palette.primary.dark,
                                    fontWeight: 600,
                                    backdropFilter: 'blur(8px)',
                                    transition: 'all 0.2s ease',
                                    '&:hover': {
                                      transform: 'translateY(-1px)',
                                      boxShadow: '0 4px 12px rgba(25, 118, 210, 0.2)',
                                      borderColor: (theme) =>
                                        theme.palette.mode === 'dark'
                                          ? 'rgba(100, 181, 246, 0.6)'
                                          : 'rgba(25, 118, 210, 0.4)',
                                    },
                                    '& .MuiChip-label': {
                                      px: 1.5,
                                      py: 0,
                                      fontSize: '0.75rem'
                                    }
                                  }}
                                />
                              ))
                            ) : !profile.readOnly ? (
                              <Typography variant="caption" color="text.secondary">
                                No tags
                              </Typography>
                            ) : null;
                          })()}
                        </Box>
                      </TableCell>
                      <TableCell align="center">
                        <Typography variant="body2" fontWeight={500}>
                          {profile.dashboardCount}
                        </Typography>
                      </TableCell>
                      <TableCell align="center">
                        <Typography variant="body2" fontWeight={500}>
                          {profile.sloCount}
                        </Typography>
                      </TableCell>
                      <TableCell align="center">
                        <Typography variant="body2" fontWeight={500}>
                          {profile.deepLinksCount}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
