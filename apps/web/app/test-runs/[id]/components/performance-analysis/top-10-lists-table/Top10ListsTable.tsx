'use client';

import {
  Box,
  CircularProgress,
  Alert,
} from '@mui/material';
import { useTop10TableData } from './hooks';
import { Top10TransactionDimensionCard, Top10TransactionActionMenu } from './components';
import type { Top10ListsTableProps } from './types';

export default function Top10ListsTable({
  testRunId,
  selectedScenarios = [],
  hasDistributedTracing = false,
  hasDynatrace = false,
  onDrillDownToDistributedTracing,
  onDrillDownToDynatrace,
}: Top10ListsTableProps) {
  const {
    loading,
    error,
    dimensions,
    sortFields,
    sortOrders,
    handleSort,
    getSortedData,
    actionMenuAnchor,
    actionMenuData,
    handleOpenActionMenu,
    handleCloseActionMenu,
  } = useTop10TableData({ testRunId, selectedScenarios });

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
      {/* Dimensions */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {dimensions.map((dimension, index) => (
          <Top10TransactionDimensionCard
            key={index}
            dimension={dimension}
            dimensionIndex={index}
            sortedData={getSortedData(dimension.data, index, dimension.valueField)}
            sortField={sortFields[index]}
            sortOrder={sortOrders[index]}
            hasDrillDownOptions={hasDrillDownOptions}
            onSort={handleSort}
            onOpenActionMenu={handleOpenActionMenu}
          />
        ))}
      </Box>

      {/* Action Menu */}
      <Top10TransactionActionMenu
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
