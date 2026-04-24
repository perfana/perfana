'use client';

import {
  Box,
  CircularProgress,
  Alert,
  Switch,
  FormControlLabel,
} from '@mui/material';
import { useTop10Data } from './hooks';
import { Top10DimensionCard, Top10ActionMenu } from './components';
import type { Top10ListsRequestsProps } from './types';

export default function Top10ListsRequests({
  testRunId,
  selectedScenarios = [],
  hasDistributedTracing = false,
  hasDynatrace = false,
  onDrillDownToDistributedTracing,
  onDrillDownToDynatrace,
}: Top10ListsRequestsProps) {
  const {
    loading,
    error,
    dimensions,
    sortFields,
    sortOrders,
    handleSort,
    getSortedData,
    showUrl,
    setShowUrl,
    actionMenuAnchor,
    actionMenuData,
    handleOpenActionMenu,
    handleCloseActionMenu,
  } = useTop10Data({ testRunId, selectedScenarios });

  const hasDrillDownOptions = hasDistributedTracing || hasDynatrace;

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ my: 2 }}>
        {error}
      </Alert>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* Toggle Control */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
        <FormControlLabel
          control={
            <Switch
              checked={showUrl}
              onChange={(e) => setShowUrl(e.target.checked)}
              color="primary"
            />
          }
          label={showUrl ? 'Show URL' : 'Show Request Name'}
          sx={{
            '& .MuiFormControlLabel-label': {
              fontSize: '0.9rem',
              fontWeight: 500,
            }
          }}
        />
      </Box>

      {/* Dimensions */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {dimensions.map((dimension, index) => (
          <Top10DimensionCard
            key={index}
            dimension={dimension}
            dimensionIndex={index}
            sortedData={getSortedData(dimension.data, index, dimension.valueField)}
            sortField={sortFields[index]}
            sortOrder={sortOrders[index]}
            showUrl={showUrl}
            hasDrillDownOptions={hasDrillDownOptions}
            onSort={handleSort}
            onOpenActionMenu={handleOpenActionMenu}
          />
        ))}
      </Box>

      {/* Action Menu */}
      <Top10ActionMenu
        anchorEl={actionMenuAnchor}
        item={actionMenuData}
        hasDistributedTracing={hasDistributedTracing}
        hasDynatrace={hasDynatrace}
        onClose={handleCloseActionMenu}
        onDrillDownToDistributedTracing={onDrillDownToDistributedTracing}
        onDrillDownToDynatrace={onDrillDownToDynatrace}
      />
    </Box>
  );
}
