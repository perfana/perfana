import { useState } from 'react';
import {
  Box,
  Paper,
  Alert,
  CircularProgress,
  Typography,
  Button,
  ButtonGroup,
  Menu,
  MenuItem,
  Toolbar,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Close as CloseIcon,
  ContentCopy as CopyIcon,
  ArrowDropDown as ArrowDropDownIcon,
} from '@mui/icons-material';
import { Benchmark } from './types';
import FilterBar from './FilterBar';
import SLOTable from './SLOTable';
import { CopyToScopeDialog, type CopyTarget } from './shared/CopyToScopeDialog';
import { copyBenchmarks } from '@/lib/api/config-copy';

interface SLOSectionProps {
  systemId: string;
  systemName?: string;
  selectedEnvironment: string;
  selectedWorkload: string;
  benchmarks: Benchmark[];
  loading: boolean;
  searchText: string;
  onSearchChange: (text: string) => void;
  selectedTags: string[];
  onTagToggle: (tag: string) => void;
  onClearTags: () => void;
  onAddSLO: () => void;
  onAddAggregatedSLO: () => void;
  onEditSLO: (benchmark: Benchmark) => void;
  onDeleteSLO: (benchmark: Benchmark) => void;
  onViewSLO: (benchmark: Benchmark) => void;
  onBatchDelete: (ids: string[]) => Promise<void>;
}

export default function SLOSection({
  systemId,
  systemName,
  selectedEnvironment,
  selectedWorkload,
  benchmarks,
  loading,
  searchText,
  onSearchChange,
  selectedTags,
  onTagToggle,
  onClearTags,
  onAddSLO,
  onAddAggregatedSLO,
  onEditSLO,
  onDeleteSLO,
  onViewSLO,
  onBatchDelete
}: SLOSectionProps) {
  // Split button menu state
  const [splitMenuAnchor, setSplitMenuAnchor] = useState<HTMLElement | null>(null);

  // Multi-select state
  const [selectedSloIds, setSelectedSloIds] = useState<Set<string>>(new Set());
  const [batchDeleteDialogOpen, setBatchDeleteDialogOpen] = useState(false);
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [copySuccess, setCopySuccess] = useState<string | null>(null);

  // Get all unique tags from benchmarks
  const getAllSloTags = () => {
    const allTags = new Set<string>();
    benchmarks.forEach(benchmark => {
      if (benchmark.tags) {
        benchmark.tags.forEach(tag => allTags.add(tag));
      }
    });
    return Array.from(allTags).sort();
  };

  // Get filtered benchmarks (for checkbox logic)
  const getFilteredBenchmarks = () => {
    let filtered = benchmarks;

    // Apply search filter
    if (searchText) {
      const searchLower = searchText.toLowerCase();
      filtered = filtered.filter(b =>
        b.panel_title?.toLowerCase().includes(searchLower) ||
        b.description?.toLowerCase().includes(searchLower) ||
        b.config_title?.toLowerCase().includes(searchLower) ||
        b.dashboard_label?.toLowerCase().includes(searchLower)
      );
    }

    // Apply tag filter (OR logic)
    if (selectedTags.length > 0) {
      filtered = filtered.filter(b =>
        selectedTags.some(tag => b.tags?.includes(tag))
      );
    }

    return filtered;
  };

  const filteredBenchmarks = getFilteredBenchmarks();

  // Multi-select handlers
  const handleSelectAll = () => {
    if (selectedSloIds.size === filteredBenchmarks.length) {
      setSelectedSloIds(new Set());
    } else {
      setSelectedSloIds(new Set(filteredBenchmarks.map(b => b.id)));
    }
  };

  const handleSelectOne = (id: string) => {
    const newSelected = new Set(selectedSloIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedSloIds(newSelected);
  };

  const handleClearSelection = () => {
    setSelectedSloIds(new Set());
  };

  // Batch delete handlers
  const handleBatchDeleteClick = () => {
    setBatchDeleteDialogOpen(true);
  };

  const handleBatchDeleteConfirm = async () => {
    const idsToDelete = Array.from(selectedSloIds);
    await onBatchDelete(idsToDelete);
    setBatchDeleteDialogOpen(false);
    handleClearSelection();
  };

  const handleBatchDeleteCancel = () => {
    setBatchDeleteDialogOpen(false);
  };

  const handleCopy = async (target: CopyTarget) => {
    const result = await copyBenchmarks({
      sourceSystemUnderTestId: systemId,
      sourceTestEnvironment: selectedEnvironment,
      sourceWorkload: selectedWorkload,
      targetSystemUnderTestId: target.systemUnderTestId,
      targetTestEnvironment: target.testEnvironment,
      targetWorkload: target.workload || selectedWorkload,
      conflictStrategy: target.conflictStrategy,
      ids: selectedSloIds.size > 0 ? Array.from(selectedSloIds) : undefined,
    });
    setCopySuccess(`Copied ${result.copied} SLO${result.copied !== 1 ? 's' : ''}${result.skipped > 0 ? `, skipped ${result.skipped} duplicate${result.skipped !== 1 ? 's' : ''}` : ''}`);
  };

  if (!selectedEnvironment || !selectedWorkload) {
    return (
      <Paper sx={{ p: 3, mb: 3, mx: 3 }}>
        <Alert severity="info">
          Please select a test environment and workload above to view configured service level objectives.
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
            Loading service level objectives...
          </Typography>
        </Box>
      </Paper>
    );
  }

  if (benchmarks.length === 0) {
    return (
      <Paper sx={{ p: 3, mb: 3, mx: 3 }}>
        <Alert severity="info">
          No service level objectives found for {systemName} in {selectedEnvironment} environment with {selectedWorkload} workload.
        </Alert>
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={onAddSLO}
          >
            Add First SLO
          </Button>
        </Box>
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

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Box sx={{ flex: 1 }}>
            <FilterBar
              searchText={searchText}
              onSearchChange={onSearchChange}
              selectedTags={selectedTags}
              availableTags={getAllSloTags()}
              onTagToggle={onTagToggle}
              onClearTags={onClearTags}
              showAddButton={false}
              placeholder="Search SLOs by metric, description, or dashboard..."
            />
          </Box>
          <ButtonGroup variant="contained" size="small">
            <Button startIcon={<AddIcon />} onClick={onAddSLO}>
              Add Metric SLO
            </Button>
            <Button
              size="small"
              onClick={(e) => setSplitMenuAnchor(e.currentTarget)}
              sx={{ px: 0.5 }}
            >
              <ArrowDropDownIcon />
            </Button>
          </ButtonGroup>
          <Menu
            anchorEl={splitMenuAnchor}
            open={Boolean(splitMenuAnchor)}
            onClose={() => setSplitMenuAnchor(null)}
          >
            <MenuItem onClick={() => { onAddSLO(); setSplitMenuAnchor(null); }}>
              Add Metric SLO
            </MenuItem>
            <MenuItem onClick={() => { onAddAggregatedSLO(); setSplitMenuAnchor(null); }}>
              Add Aggregated SLO
            </MenuItem>
          </Menu>
        </Box>

        {/* Batch Actions Toolbar */}
        {selectedSloIds.size > 0 && (
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
                {selectedSloIds.size} SLO{selectedSloIds.size > 1 ? 's' : ''} selected
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
        {selectedSloIds.size === 0 && benchmarks.length > 0 && (
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

        <SLOTable
          benchmarks={benchmarks}
          searchText={searchText}
          selectedTags={selectedTags}
          selectedSloIds={selectedSloIds}
          onEdit={onEditSLO}
          onDelete={onDeleteSLO}
          onView={onViewSLO}
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
          workload: selectedWorkload,
        }}
        itemCount={benchmarks.length}
        selectedCount={selectedSloIds.size > 0 ? selectedSloIds.size : undefined}
        itemType="SLOs"
        supportsWorkload={true}
      />

      {/* Batch Delete Confirmation Dialog */}
      <Dialog open={batchDeleteDialogOpen} onClose={handleBatchDeleteCancel}>
        <DialogTitle>Delete Multiple SLOs</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete {selectedSloIds.size} SLO{selectedSloIds.size > 1 ? 's' : ''}? This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleBatchDeleteCancel}>Cancel</Button>
          <Button onClick={handleBatchDeleteConfirm} color="error" variant="contained">
            Delete {selectedSloIds.size} SLO{selectedSloIds.size > 1 ? 's' : ''}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}