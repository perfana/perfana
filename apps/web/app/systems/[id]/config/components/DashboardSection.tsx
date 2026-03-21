import { useState } from 'react';
import {
  Box,
  Paper,
  Alert,
  CircularProgress,
  Typography,
  Toolbar,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  FormControlLabel,
  Checkbox,
  List,
  ListItem,
  ListItemText,
} from '@mui/material';
import {
  Delete as DeleteIcon,
  Close as CloseIcon,
  ContentCopy as CopyIcon,
} from '@mui/icons-material';
import { ApplicationDashboard } from './types';
import { filterSystemTags } from '@perfana/shared/utils';
import { authenticatedFetch } from '@/lib/api';
import FilterBar from './FilterBar';
import DashboardTable from './DashboardTable';
import { CopyToScopeDialog, type CopyTarget } from './shared/CopyToScopeDialog';
import { copyDashboards } from '@/lib/api/config-copy';

interface OrphanedDashboard {
  applicationDashboardId: string;
  grafanaDashboardName: string;
  grafanaDashboardUid: string;
}

interface BatchDeleteInfo {
  orphanedDashboards: OrphanedDashboard[];
  nonOrphanedCount: number;
}

interface DashboardSectionProps {
  systemId: string;
  systemName?: string;
  selectedEnvironment: string;
  selectedWorkload: string;
  dashboards: ApplicationDashboard[];
  loading: boolean;
  searchText: string;
  onSearchChange: (text: string) => void;
  selectedTags: string[];
  onTagToggle: (tag: string) => void;
  onClearTags: () => void;
  onAddDashboard: () => void;
  onEditDashboard: (dashboard: ApplicationDashboard) => void;
  onDeleteDashboard: (dashboard: ApplicationDashboard) => void;
  onBatchDelete: (ids: string[], deleteFromGrafana?: boolean) => Promise<void>;
}

export default function DashboardSection({
  systemId,
  systemName,
  selectedEnvironment,
  selectedWorkload,
  dashboards,
  loading,
  searchText,
  onSearchChange,
  selectedTags,
  onTagToggle,
  onClearTags,
  onAddDashboard,
  onEditDashboard,
  onDeleteDashboard,
  onBatchDelete
}: DashboardSectionProps) {
  // Multi-select state
  const [selectedDashboardIds, setSelectedDashboardIds] = useState<Set<string>>(new Set());
  const [batchDeleteDialogOpen, setBatchDeleteDialogOpen] = useState(false);
  const [batchDeleteInfo, setBatchDeleteInfo] = useState<BatchDeleteInfo | null>(null);
  const [batchDeleteFromGrafana, setBatchDeleteFromGrafana] = useState(false);
  const [batchDeleteLoading, setBatchDeleteLoading] = useState(false);
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [copySuccess, setCopySuccess] = useState<string | null>(null);

  // Get all unique tags from dashboards (excluding system tags)
  const getAllDashboardTags = () => {
    const allTags = new Set<string>();
    dashboards.forEach(dashboard => {
      if (dashboard.tags) {
        const filteredTags = filterSystemTags(dashboard.tags);
        filteredTags.forEach(tag => allTags.add(tag));
      }
    });
    return Array.from(allTags).sort();
  };

  // Get filtered dashboards (for checkbox logic)
  const getFilteredDashboards = () => {
    let filtered = dashboards;

    // Apply search filter
    if (searchText) {
      const searchLower = searchText.toLowerCase();
      filtered = filtered.filter(d =>
        d.dashboard_name.toLowerCase().includes(searchLower) ||
        d.dashboard_label?.toLowerCase().includes(searchLower) ||
        d.tags?.some(t => t.toLowerCase().includes(searchLower))
      );
    }

    // Apply tag filter (OR logic)
    if (selectedTags.length > 0) {
      filtered = filtered.filter(d => {
        const dashboardTags = filterSystemTags(d.tags || []);
        return selectedTags.some(tag => dashboardTags.includes(tag));
      });
    }

    return filtered;
  };

  const filteredDashboards = getFilteredDashboards();

  // Multi-select handlers
  const handleSelectAll = () => {
    if (selectedDashboardIds.size === filteredDashboards.length) {
      setSelectedDashboardIds(new Set());
    } else {
      setSelectedDashboardIds(new Set(filteredDashboards.map(d => d.id)));
    }
  };

  const handleSelectOne = (id: string) => {
    const newSelected = new Set(selectedDashboardIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedDashboardIds(newSelected);
  };

  const handleClearSelection = () => {
    setSelectedDashboardIds(new Set());
  };

  // Batch delete handlers
  const handleBatchDeleteClick = async () => {
    const idsToDelete = Array.from(selectedDashboardIds);

    try {
      setBatchDeleteLoading(true);
      // Fetch batch delete info to check for orphaned dashboards
      const response = await authenticatedFetch('/grafana/application-dashboards/batch-delete-info', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ids: idsToDelete }),
      });

      if (response.ok) {
        const info = await response.json();
        setBatchDeleteInfo(info);
      } else {
        setBatchDeleteInfo(null);
      }
    } catch (err) {
      console.error('Error fetching batch delete info:', err);
      setBatchDeleteInfo(null);
    } finally {
      setBatchDeleteLoading(false);
    }

    setBatchDeleteFromGrafana(false);
    setBatchDeleteDialogOpen(true);
  };

  const handleBatchDeleteConfirm = async () => {
    const idsToDelete = Array.from(selectedDashboardIds);
    await onBatchDelete(idsToDelete, batchDeleteFromGrafana);
    setBatchDeleteDialogOpen(false);
    setBatchDeleteInfo(null);
    setBatchDeleteFromGrafana(false);
    handleClearSelection();
  };

  const handleBatchDeleteCancel = () => {
    setBatchDeleteDialogOpen(false);
    setBatchDeleteInfo(null);
    setBatchDeleteFromGrafana(false);
  };

  const handleCopy = async (target: CopyTarget) => {
    const result = await copyDashboards({
      sourceSystemUnderTestId: systemId,
      sourceTestEnvironment: selectedEnvironment,
      targetSystemUnderTestId: target.systemUnderTestId,
      targetTestEnvironment: target.testEnvironment,
      conflictStrategy: target.conflictStrategy,
      ids: selectedDashboardIds.size > 0 ? Array.from(selectedDashboardIds) : undefined,
    });
    setCopySuccess(`Copied ${result.copied} dashboard${result.copied !== 1 ? 's' : ''}${result.skipped > 0 ? `, skipped ${result.skipped} duplicate${result.skipped !== 1 ? 's' : ''}` : ''}`);
  };

  if (!selectedEnvironment) {
    return (
      <Paper sx={{ p: 3, mb: 3, mx: 3 }}>
        <Alert severity="info">
          Please select a test environment above to view configured dashboards.
        </Alert>
      </Paper>
    );
  }

  if (loading) {
    return (
      <Paper sx={{ p: 3, mb: 3, mx: 3 }}>
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
          <CircularProgress />
          <Typography variant="body1" sx={{ ml: 2 }}>
            Loading application dashboards...
          </Typography>
        </Box>
      </Paper>
    );
  }

  if (dashboards.length === 0) {
    return (
      <Paper sx={{ p: 3, mb: 3, mx: 3 }}>
        <Alert severity="info">
          No application dashboards found for {systemName} in {selectedEnvironment} environment
          {selectedWorkload && ` with ${selectedWorkload} workload`}.
        </Alert>
      </Paper>
    );
  }

  return (
    <>
      <Paper sx={{ p: 3, mb: 3, mx: 3 }}>
        {/* Copy Success Alert */}
        {copySuccess && (
          <Alert severity="success" sx={{ mb: 2 }} onClose={() => setCopySuccess(null)}>
            {copySuccess}
          </Alert>
        )}

        <FilterBar
          searchText={searchText}
          onSearchChange={onSearchChange}
          selectedTags={selectedTags}
          availableTags={getAllDashboardTags()}
          onTagToggle={onTagToggle}
          onClearTags={onClearTags}
          showAddButton={true}
          onAddClick={onAddDashboard}
          addButtonText="Add Dashboard"
          placeholder="Search dashboards by name, label, or tags..."
        />

        {/* Batch Actions Toolbar */}
        {selectedDashboardIds.size > 0 && (
          <Paper sx={{ mb: 2 }}>
            <Toolbar
              sx={{
                pl: { sm: 2 },
                pr: { xs: 1, sm: 1 },
                bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(56, 142, 232, 0.15)' : 'rgba(25, 118, 210, 0.08)',
              }}
            >
              <Typography
                sx={{ flex: '1 1 100%' }}
                color="primary"
                variant="subtitle1"
                component="div"
              >
                {selectedDashboardIds.size} dashboard{selectedDashboardIds.size > 1 ? 's' : ''} selected
              </Typography>
              <Tooltip title="Copy selected to another scope">
                <IconButton onClick={() => setCopyDialogOpen(true)} color="primary">
                  <CopyIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title="Delete selected">
                <IconButton onClick={handleBatchDeleteClick} color="error">
                  <DeleteIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title="Clear selection">
                <IconButton onClick={handleClearSelection}>
                  <CloseIcon />
                </IconButton>
              </Tooltip>
            </Toolbar>
          </Paper>
        )}
        {/* Copy to button (when nothing selected, copies all) */}
        {selectedDashboardIds.size === 0 && dashboards.length > 0 && (
          <Box sx={{ mb: 2, display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="outlined"
              size="small"
              startIcon={<CopyIcon />}
              onClick={() => setCopyDialogOpen(true)}
            >
              Copy all to...
            </Button>
          </Box>
        )}

        <DashboardTable
          dashboards={dashboards}
          searchText={searchText}
          selectedTags={selectedTags}
          selectedDashboardIds={selectedDashboardIds}
          onEdit={onEditDashboard}
          onDelete={onDeleteDashboard}
          onClearSearch={() => onSearchChange('')}
          onClearTags={onClearTags}
          onSelectAll={handleSelectAll}
          onSelectOne={handleSelectOne}
        />
      </Paper>

      {/* Copy to Scope Dialog */}
      <CopyToScopeDialog
        open={copyDialogOpen}
        onClose={() => setCopyDialogOpen(false)}
        onCopy={handleCopy}
        currentScope={{
          systemId,
          systemName: systemName || '',
          environment: selectedEnvironment,
        }}
        itemCount={dashboards.length}
        selectedCount={selectedDashboardIds.size > 0 ? selectedDashboardIds.size : undefined}
        itemType="dashboards"
        supportsWorkload={false}
      />

      {/* Batch Delete Confirmation Dialog */}
      <Dialog open={batchDeleteDialogOpen} onClose={handleBatchDeleteCancel} maxWidth="sm" fullWidth>
        <DialogTitle>Delete Multiple Dashboards</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete {selectedDashboardIds.size} dashboard{selectedDashboardIds.size > 1 ? 's' : ''}? This action cannot be undone.
          </DialogContentText>

          {batchDeleteInfo && batchDeleteInfo.orphanedDashboards.length > 0 && (
            <Box sx={{ mt: 2 }}>
              <Alert severity="warning" sx={{ mb: 2 }}>
                The following {batchDeleteInfo.orphanedDashboards.length} dashboard{batchDeleteInfo.orphanedDashboards.length > 1 ? 's are' : ' is'} not used by any other system. You can optionally delete {batchDeleteInfo.orphanedDashboards.length > 1 ? 'them' : 'it'} from Grafana as well.
              </Alert>
              <List dense sx={{ bgcolor: 'action.hover', borderRadius: 1, mb: 2 }}>
                {batchDeleteInfo.orphanedDashboards.map((orphan) => (
                  <ListItem key={orphan.applicationDashboardId}>
                    <ListItemText
                      primary={orphan.grafanaDashboardName}
                      secondary={`UID: ${orphan.grafanaDashboardUid}`}
                    />
                  </ListItem>
                ))}
              </List>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={batchDeleteFromGrafana}
                    onChange={(e) => setBatchDeleteFromGrafana(e.target.checked)}
                    color="error"
                  />
                }
                label={`Also delete ${batchDeleteInfo.orphanedDashboards.length} dashboard${batchDeleteInfo.orphanedDashboards.length > 1 ? 's' : ''} from Grafana`}
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleBatchDeleteCancel}>Cancel</Button>
          <Button onClick={handleBatchDeleteConfirm} color="error" variant="contained">
            Delete {selectedDashboardIds.size} Dashboard{selectedDashboardIds.size > 1 ? 's' : ''}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}