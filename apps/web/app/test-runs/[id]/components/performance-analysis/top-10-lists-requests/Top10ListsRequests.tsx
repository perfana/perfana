'use client';

import { useState } from 'react';
import {
  Box,
  CircularProgress,
  Alert,
} from '@mui/material';
import { useTop10Data } from './hooks';
import { Top10DimensionCard, Top10ActionMenu } from './components';
import { Top10Filter } from '../components';
import type { Top10ListsRequestsProps } from './types';

export default function Top10ListsRequests({
  testRunId,
  selectedScenarios = [],
  excludeRampUp = false,
  hasDistributedTracing = false,
  hasDynatrace = false,
  onDrillDownToDistributedTracing,
  onDrillDownToDynatrace,
}: Top10ListsRequestsProps) {
  const [nameFilter, setNameFilter] = useState('');
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
  } = useTop10Data({ testRunId, selectedScenarios, excludeRampUp, nameFilter });

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
      <Box sx={{ mb: 2 }}>
        <Top10Filter value={nameFilter} onChange={setNameFilter} placeholder="Filter requests..." />
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
