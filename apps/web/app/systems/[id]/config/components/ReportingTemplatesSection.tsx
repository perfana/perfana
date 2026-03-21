import { useState } from 'react';
import {
  Box,
  Paper,
  Alert,
  CircularProgress,
  Typography,
  TextField,
  InputAdornment,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Toolbar,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  Search as SearchIcon,
  Add as AddIcon,
  Description as DescriptionIcon,
  Delete as DeleteIcon,
  Close as CloseIcon,
  ContentCopy as CopyIcon,
} from '@mui/icons-material';
import { type TemplateListItem } from '@/lib/api/reports';
import TemplateTable from './TemplateTable';
import { CopyToScopeDialog, type CopyTarget } from './shared/CopyToScopeDialog';
import { copyReportTemplates } from '@/lib/api/config-copy';

interface ReportingTemplatesSectionProps {
  systemId: string;
  systemName: string;
  selectedEnvironment: string;
  selectedWorkload: string;
  templates: TemplateListItem[];
  loading: boolean;
  searchText: string;
  onSearchChange: (text: string) => void;
  onAddTemplate: () => void;
  onEditTemplate: (template: TemplateListItem) => void;
  onDeleteTemplate: (template: TemplateListItem) => void;
  onDuplicateTemplate: (template: TemplateListItem, newName: string) => Promise<void>;
  onSetDefaultTemplate: (templateId: string) => Promise<void>;
  onBatchDelete: (ids: string[]) => Promise<void>;
}

export default function ReportingTemplatesSection({
  systemId,
  systemName,
  selectedEnvironment,
  selectedWorkload,
  templates,
  loading,
  searchText,
  onSearchChange,
  onAddTemplate,
  onEditTemplate,
  onDeleteTemplate,
  onDuplicateTemplate,
  onSetDefaultTemplate,
  onBatchDelete,
}: ReportingTemplatesSectionProps) {
  // Duplicate dialog state
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false);
  const [duplicatingTemplate, setDuplicatingTemplate] = useState<TemplateListItem | null>(null);
  const [duplicateName, setDuplicateName] = useState('');
  const [duplicateLoading, setDuplicateLoading] = useState(false);
  const [duplicateError, setDuplicateError] = useState('');

  // Multi-select state
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<Set<string>>(new Set());
  const [batchDeleteDialogOpen, setBatchDeleteDialogOpen] = useState(false);
  const [batchDeleteLoading, setBatchDeleteLoading] = useState(false);
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [copySuccess, setCopySuccess] = useState<string | null>(null);

  const handleDuplicateClick = (template: TemplateListItem) => {
    setDuplicatingTemplate(template);
    setDuplicateName(`${template.name} (Copy)`);
    setDuplicateError('');
    setDuplicateDialogOpen(true);
  };

  const handleDuplicateConfirm = async () => {
    if (!duplicatingTemplate || !duplicateName.trim()) return;

    try {
      setDuplicateLoading(true);
      setDuplicateError('');
      await onDuplicateTemplate(duplicatingTemplate, duplicateName.trim());
      setDuplicateDialogOpen(false);
      setDuplicatingTemplate(null);
      setDuplicateName('');
    } catch (err) {
      const errorMessage =
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to duplicate template';
      setDuplicateError(errorMessage);
    } finally {
      setDuplicateLoading(false);
    }
  };

  const handleSetDefault = async (templateId: string) => {
    try {
      await onSetDefaultTemplate(templateId);
    } catch (err) {
      // Error is handled by parent
    }
  };

  // Get filtered templates (for checkbox logic)
  const getFilteredTemplates = () => {
    let filtered = templates;

    // Apply search filter
    if (searchText) {
      const searchLower = searchText.toLowerCase();
      filtered = filtered.filter(
        (t) =>
          t.name.toLowerCase().includes(searchLower) ||
          t.description?.toLowerCase().includes(searchLower) ||
          t.created_by?.toLowerCase().includes(searchLower)
      );
    }

    return filtered;
  };

  const filteredTemplates = getFilteredTemplates();

  // Multi-select handlers
  const handleSelectAll = () => {
    if (selectedTemplateIds.size === filteredTemplates.length) {
      setSelectedTemplateIds(new Set());
    } else {
      setSelectedTemplateIds(new Set(filteredTemplates.map((t) => t.id)));
    }
  };

  const handleSelectOne = (id: string) => {
    const newSelected = new Set(selectedTemplateIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedTemplateIds(newSelected);
  };

  const handleClearSelection = () => {
    setSelectedTemplateIds(new Set());
  };

  // Batch delete handlers
  const handleBatchDeleteClick = () => {
    setBatchDeleteDialogOpen(true);
  };

  const handleBatchDeleteConfirm = async () => {
    const idsToDelete = Array.from(selectedTemplateIds);
    try {
      setBatchDeleteLoading(true);
      await onBatchDelete(idsToDelete);
      setBatchDeleteDialogOpen(false);
      handleClearSelection();
    } catch (err) {
      // Error is handled by parent
    } finally {
      setBatchDeleteLoading(false);
    }
  };

  const handleBatchDeleteCancel = () => {
    setBatchDeleteDialogOpen(false);
  };

  const handleCopy = async (target: CopyTarget) => {
    const result = await copyReportTemplates({
      sourceSystemId: systemId,
      sourceTestEnvironment: selectedEnvironment,
      sourceWorkload: selectedWorkload,
      targetSystemId: target.systemUnderTestId,
      targetTestEnvironment: target.testEnvironment,
      targetWorkload: target.workload || selectedWorkload,
      conflictStrategy: target.conflictStrategy,
      ids: selectedTemplateIds.size > 0 ? Array.from(selectedTemplateIds) : undefined,
    });
    setCopySuccess(`Copied ${result.copied} template${result.copied !== 1 ? 's' : ''}${result.skipped > 0 ? `, skipped ${result.skipped} duplicate${result.skipped !== 1 ? 's' : ''}` : ''}`);
  };

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 2 }}>
        <DescriptionIcon sx={{ fontSize: 32, color: 'primary.main' }} />
        <Box sx={{ flex: 1 }}>
          <Typography variant="h6" fontWeight={600}>
            Reporting Templates
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Create and manage report templates for {systemName} ({selectedEnvironment} / {selectedWorkload})
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {templates.length > 0 && (
            <Button
              variant="outlined"
              startIcon={<CopyIcon />}
              onClick={() => setCopyDialogOpen(true)}
            >
              {selectedTemplateIds.size > 0 ? `Copy ${selectedTemplateIds.size} to...` : 'Copy to...'}
            </Button>
          )}
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={onAddTemplate}
          >
            Create Template
          </Button>
        </Box>
      </Box>

      {/* Copy Success Alert */}
      {copySuccess && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setCopySuccess(null)}>
          {copySuccess}
        </Alert>
      )}

      {/* Search Bar */}
      <Box sx={{ mb: 2 }}>
        <TextField
          fullWidth
          placeholder="Search templates by name, description, or creator"
          value={searchText}
          onChange={(e) => onSearchChange(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            ),
          }}
          size="small"
        />
      </Box>

      {/* Batch Actions Toolbar */}
      {selectedTemplateIds.size > 0 && (
        <Paper sx={{ mb: 2 }} elevation={0} variant="outlined">
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
              {selectedTemplateIds.size} template{selectedTemplateIds.size > 1 ? 's' : ''} selected
            </Typography>
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

      {/* Loading State */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Paper elevation={0} variant="outlined">
          <TemplateTable
            templates={templates}
            searchText={searchText}
            selectedTemplateIds={selectedTemplateIds}
            onEdit={onEditTemplate}
            onDelete={onDeleteTemplate}
            onDuplicate={handleDuplicateClick}
            onSetDefault={handleSetDefault}
            onClearSearch={() => onSearchChange('')}
            onSelectAll={handleSelectAll}
            onSelectOne={handleSelectOne}
          />
        </Paper>
      )}

      {/* Info Message */}
      {!loading && templates.length === 0 && !searchText && (
        <Alert severity="info" sx={{ mt: 2 }}>
          <Typography variant="body2">
            No reporting templates configured yet. Create a template to define reusable report
            structures for your test runs.
          </Typography>
        </Alert>
      )}

      {/* Copy to Scope Dialog */}
      <CopyToScopeDialog
        open={copyDialogOpen}
        onClose={() => setCopyDialogOpen(false)}
        onCopy={handleCopy}
        currentScope={{
          systemId,
          systemName,
          environment: selectedEnvironment,
          workload: selectedWorkload,
        }}
        itemCount={templates.length}
        selectedCount={selectedTemplateIds.size > 0 ? selectedTemplateIds.size : undefined}
        itemType="report templates"
        supportsWorkload={true}
      />

      {/* Duplicate Dialog */}
      <Dialog
        open={duplicateDialogOpen}
        onClose={() => !duplicateLoading && setDuplicateDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Duplicate Template</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Enter a name for the duplicated template:
          </DialogContentText>
          <TextField
            autoFocus
            fullWidth
            label="Template Name"
            value={duplicateName}
            onChange={(e) => setDuplicateName(e.target.value)}
            disabled={duplicateLoading}
            error={!!duplicateError}
            helperText={duplicateError}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDuplicateDialogOpen(false)} disabled={duplicateLoading}>
            Cancel
          </Button>
          <Button
            onClick={handleDuplicateConfirm}
            variant="contained"
            disabled={!duplicateName.trim() || duplicateLoading}
          >
            {duplicateLoading ? <CircularProgress size={20} /> : 'Duplicate'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Batch Delete Confirmation Dialog */}
      <Dialog open={batchDeleteDialogOpen} onClose={handleBatchDeleteCancel} maxWidth="sm" fullWidth>
        <DialogTitle>Delete Multiple Templates</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete {selectedTemplateIds.size} template
            {selectedTemplateIds.size > 1 ? 's' : ''}? This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleBatchDeleteCancel} disabled={batchDeleteLoading}>
            Cancel
          </Button>
          <Button
            onClick={handleBatchDeleteConfirm}
            color="error"
            variant="contained"
            disabled={batchDeleteLoading}
          >
            {batchDeleteLoading ? <CircularProgress size={20} /> : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
