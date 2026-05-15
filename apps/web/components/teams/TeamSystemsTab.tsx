'use client';

import { useState, useEffect, useCallback } from 'react';
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
  Chip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  CircularProgress,
  Tooltip,
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Computer as ComputerIcon,
  Link as LinkIcon,
} from '@mui/icons-material';
import { authenticatedFetch } from '@/lib/api';
import { updateSystemUnderTest } from '@/lib/systems';
import { useOrganizationContext } from '@/lib/contexts/organization-context';

interface System {
  id: string;
  name: string;
  description?: string;
  team_id?: string | null;
  created_at: string;
}

interface TeamSystemsTabProps {
  teamId: string;
}

export function TeamSystemsTab({ teamId }: TeamSystemsTabProps) {
  const [systems, setSystems] = useState<System[]>([]);
  const [availableSystems, setAvailableSystems] = useState<System[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [selectedSystemId, setSelectedSystemId] = useState('');
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const { currentOrganizationId } = useOrganizationContext();

  // Fetch systems for this team
  const fetchTeamSystems = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch systems filtered by active organization
      const url = currentOrganizationId
        ? `/systems-under-test?organizationId=${encodeURIComponent(currentOrganizationId)}`
        : '/systems-under-test';
      const response = await authenticatedFetch(url);
      if (!response.ok) {
        throw new Error('Failed to fetch systems');
      }

      const allSystems = await response.json();

      // Filter systems assigned to this team
      const teamSystems = allSystems.filter((s: System) => s.team_id === teamId);
      setSystems(teamSystems);

      // Available systems are those not assigned to this team
      const available = allSystems.filter((s: System) => s.team_id !== teamId);
      setAvailableSystems(available);
    } catch (err) {
      const errorMessage =
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to load systems';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [teamId, currentOrganizationId]);

  useEffect(() => {
    if (teamId) {
      fetchTeamSystems();
    }
  }, [teamId, fetchTeamSystems]);

  const handleAddSystem = async () => {
    if (!selectedSystemId) return;

    try {
      setSaving(true);
      setError(null);

      const updatePayload = { team_id: teamId };
      await updateSystemUnderTest(selectedSystemId, updatePayload);

      // Refresh the list
      await fetchTeamSystems();

      setAddDialogOpen(false);
      setSelectedSystemId('');

      // Show success message
      const systemName = availableSystems.find(s => s.id === selectedSystemId)?.name || 'System';
      setSuccessMessage(`${systemName} added to team successfully`);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      const errorMessage =
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to add system to team';
      console.error('❌ Error adding system:', err);
      setError(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveSystem = async (systemId: string) => {
    try {
      setError(null);

      await updateSystemUnderTest(systemId, {
        team_id: null,
      });

      // Refresh the list
      await fetchTeamSystems();
    } catch (err) {
      const errorMessage =
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to remove system from team';
      setError(errorMessage);
    }
  };

  const handleOpenConfig = (systemId: string) => {
    window.open(`/systems/${systemId}/config`, '_blank');
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Box>
          <Typography variant="h6" gutterBottom>
            Systems Under Test
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Systems assigned to this team. Team members can manage these systems.
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setAddDialogOpen(true)}
          disabled={availableSystems.length === 0}
        >
          Add System
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {successMessage && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessMessage(null)}>
          {successMessage}
        </Alert>
      )}

      {systems.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <ComputerIcon sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>
            No systems assigned yet
          </Typography>
          <Typography variant="body2" color="text.secondary" paragraph>
            Add systems to this team to allow team members to manage them.
          </Typography>
          {availableSystems.length > 0 && (
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setAddDialogOpen(true)}
              sx={{ mt: 2 }}
            >
              Add Your First System
            </Button>
          )}
        </Paper>
      ) : (
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>System Name</TableCell>
                <TableCell>Description</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {systems.map((system) => (
                <TableRow key={system.id} hover>
                  <TableCell>
                    <Box display="flex" alignItems="center" gap={1}>
                      <ComputerIcon fontSize="small" color="action" />
                      <Typography variant="body2" fontWeight={500}>
                        {system.name}
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {system.description || 'No description'}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Box display="flex" gap={1} justifyContent="flex-end">
                      <Tooltip title="Open Configuration">
                        <IconButton
                          size="small"
                          onClick={() => handleOpenConfig(system.id)}
                          sx={{ color: 'primary.main' }}
                        >
                          <LinkIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Remove from Team">
                        <IconButton
                          size="small"
                          onClick={() => handleRemoveSystem(system.id)}
                          sx={{ color: 'error.main' }}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Box mt={2}>
        <Typography variant="caption" color="text.secondary">
          {systems.length} {systems.length === 1 ? 'system' : 'systems'} assigned to this team
        </Typography>
      </Box>

      {/* Add System Dialog */}
      <Dialog
        open={addDialogOpen}
        onClose={() => !saving && setAddDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Add System to Team</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2 }}>
            <FormControl fullWidth>
              <InputLabel id="system-select-label">Select System</InputLabel>
              <Select
                labelId="system-select-label"
                id="system-select"
                value={selectedSystemId}
                label="Select System"
                onChange={(e) => setSelectedSystemId(e.target.value)}
                disabled={saving}
              >
                {availableSystems.map((system) => (
                  <MenuItem key={system.id} value={system.id}>
                    <Box>
                      <Typography variant="body2" fontWeight={500}>
                        {system.name}
                      </Typography>
                      {system.description && (
                        <Typography variant="caption" color="text.secondary">
                          {system.description}
                        </Typography>
                      )}
                      {system.team_id && (
                        <Chip
                          label="Assigned to another team"
                          size="small"
                          sx={{ ml: 1, height: 20 }}
                        />
                      )}
                    </Box>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {availableSystems.length === 0 && (
              <Alert severity="info" sx={{ mt: 2 }}>
                All systems are already assigned to this team.
              </Alert>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddDialogOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={handleAddSystem}
            variant="contained"
            disabled={!selectedSystemId || saving}
            startIcon={saving ? <CircularProgress size={16} /> : <AddIcon />}
          >
            {saving ? 'Adding...' : 'Add System'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
