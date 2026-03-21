'use client';

import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Alert,
  CircularProgress,
} from '@mui/material';
import { Dashboard as DashboardIcon } from '@mui/icons-material';

import { ImportDashboardDialogProps } from './types';
import { useImportDashboard } from './hooks';
import {
  FileUploadSection,
  ImportConfigSection,
  VariablesSection,
  TilesPreviewList,
} from './components';

export default function ImportDashboardDialog({
  open,
  onClose,
  onImport,
  // Props preserved for API compatibility (used by parent component)
  systemName: _systemName,
  environment: _environment,
  loading = false,
}: ImportDashboardDialogProps) {
  const {
    // Dynatrace configs state
    dynatraceConfigs,
    loadingConfigs,
    selectedDynatraceConfigId,
    setSelectedDynatraceConfigId,

    // File state
    file,
    isAnalyzing,

    // Parsed data state
    parsedTiles,
    allVariables,
    variableValues,

    // Form state
    dashboardName,
    setDashboardName,
    metricUnit,
    setMetricUnit,
    error,

    // Handlers
    handleFileSelect,
    handleVariableChange,
    handleTileSelection,
    handleSelectAll,
    handleImport,
    handleClose,
  } = useImportDashboard({ open, onImport });

  const onDialogClose = () => {
    handleClose();
    onClose();
  };

  const selectedTilesCount = parsedTiles.filter(t => t.selected).length;
  const isImportDisabled =
    loading ||
    parsedTiles.length === 0 ||
    selectedTilesCount === 0 ||
    !dashboardName.trim() ||
    !selectedDynatraceConfigId ||
    allVariables.some(v => !variableValues[v]?.trim());

  return (
    <Dialog
      open={open}
      onClose={onDialogClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: { minHeight: '500px' },
      }}
    >
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <DashboardIcon />
          Import Dynatrace Dashboard
        </Box>
      </DialogTitle>

      <DialogContent>
        <Box sx={{ mb: 3 }}>
          <Typography variant="body2" color="text.secondary">
            Upload a Dynatrace dashboard JSON file (classic or custom format) to import
            metric queries. Supported: DATA_EXPLORER tiles with metricSelector queries
            from Dynatrace classic dashboards. Variables like $Cluster, $Node will be
            extracted and you&apos;ll be prompted for values.
          </Typography>
        </Box>

        {/* File Upload */}
        <FileUploadSection
          file={file}
          isAnalyzing={isAnalyzing}
          onFileSelect={handleFileSelect}
        />

        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>
        )}

        {/* Configuration Section (shown after file is parsed) */}
        {parsedTiles.length > 0 && (
          <ImportConfigSection
            dynatraceConfigs={dynatraceConfigs}
            loadingConfigs={loadingConfigs}
            selectedDynatraceConfigId={selectedDynatraceConfigId}
            onDynatraceConfigChange={setSelectedDynatraceConfigId}
            dashboardName={dashboardName}
            onDashboardNameChange={setDashboardName}
            metricUnit={metricUnit}
            onMetricUnitChange={setMetricUnit}
          />
        )}

        {/* Variables Section */}
        <VariablesSection
          variables={allVariables}
          variableValues={variableValues}
          onVariableChange={handleVariableChange}
        />

        {/* Tiles Preview List */}
        <TilesPreviewList
          tiles={parsedTiles}
          onTileSelection={handleTileSelection}
          onSelectAll={handleSelectAll}
        />
      </DialogContent>

      <DialogActions>
        <Button onClick={onDialogClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          onClick={handleImport}
          variant="contained"
          disabled={isImportDisabled}
          startIcon={loading ? <CircularProgress size={16} /> : undefined}
        >
          {loading
            ? 'Importing...'
            : `Import ${selectedTilesCount} Selected ${selectedTilesCount === 1 ? 'Query' : 'Queries'}`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// Re-export types for consumers
export type { DashboardTile, ImportDashboardDialogProps } from './types';
