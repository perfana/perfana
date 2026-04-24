'use client';

import React from 'react';
import { Box, Typography, TablePagination } from '@mui/material';
import { alpha } from '@mui/material/styles';

// Internal imports
import { AnomalyDetectionTableProps } from './types';
import { isPerformanceTestMetricsDashboard } from './utils';
import { useAnomalyTableHandlers } from './table-hooks';
import {
  AnomalyTableHeader,
  AnomalyTableRow,
  AnomalyExpandedContent,
  AnomalyActionMenu,
} from './table-components';
import ConfigSaveDialog from './ConfigSaveDialog';
import DeleteAnomalyDialog from './DeleteAnomalyDialog';

export default function AnomalyDetectionTable({
  paginatedData,
  filteredData,
  expandedRows,
  toggleRowExpanded,
  page,
  rowsPerPage,
  onPageChange,
  onRowsPerPageChange,
  testRunId,
  testRun,
  trendsData,
  trendsLoading,
  chartKey,
  drawerOpen,
  onDrawerToggle,
  drawerData,
  drawerLoading,
  showToast,
  showConfigForm = {},
  onConfigFormToggle = () => {},
  onConfigSave = async () => {},
  onRefreshAnomalyData,
  onDeleteAnomaly,
  hasDistributedTracing = false,
  hasDynatrace = false,
  onDrillDownToDistributedTracing,
  onDrillDownToDynatrace,
  sortBy,
  sortDirection,
  diffSortMode,
  onSortChange,
  onDiffSortModeChange,
}: AnomalyDetectionTableProps) {
  const handlers = useAnomalyTableHandlers({
    testRunId,
    testRun,
    showToast,
    onRefreshAnomalyData,
    onDeleteAnomaly,
    onConfigSave,
  });

  const hasDrillDownOptions = hasDistributedTracing || hasDynatrace;

  return (
    <Box sx={{ width: '100%' }}>
      {/* Scrollable Container */}
      <Box sx={(theme) => ({
        maxHeight: '80vh',
        overflowY: 'auto',
        overflowX: 'auto',
        borderRadius: '8px',
        border: '1px solid',
        borderColor: alpha(theme.palette.primary.main, 0.15)
      })}>
        {/* Table Header */}
        <AnomalyTableHeader
          sortBy={sortBy}
          sortDirection={sortDirection}
          diffSortMode={diffSortMode}
          onSortChange={onSortChange}
          onDiffSortModeChange={onDiffSortModeChange}
        />

        {/* No Results Message */}
        {paginatedData.length === 0 && filteredData.length === 0 && (
          <Box sx={(theme) => ({
            p: 4,
            textAlign: 'center',
            borderLeft: '1px solid',
            borderRight: '1px solid',
            borderBottom: '1px solid',
            borderColor: alpha(theme.palette.primary.main, 0.12),
            borderRadius: '0 0 8px 8px',
            backgroundColor: alpha(theme.palette.action.hover, 0.3)
          })}>
            <Typography variant="body1" color="text.secondary" sx={{ mb: 1 }}>
              No results found
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Try adjusting your filters to see more results
            </Typography>
          </Box>
        )}

        {/* Table Rows */}
        {paginatedData.map((row, index) => {
          const rowKey = `${row.dashboard_label}-${row.panel_title}-${row.metric_name}_${index}`;
          const isExpanded = expandedRows.has(rowKey);
          const isLast = index === paginatedData.length - 1;
          const hasActionMenu = Boolean(onDeleteAnomaly) || (hasDrillDownOptions && isPerformanceTestMetricsDashboard(row));

          return (
            <React.Fragment key={rowKey}>
              <AnomalyTableRow
                row={row}
                rowKey={rowKey}
                index={index}
                isExpanded={isExpanded}
                isLast={isLast && !isExpanded}
                testRunId={testRunId}
                drawerData={drawerData}
                onToggleExpanded={() => toggleRowExpanded(rowKey)}
                onOpenActionMenu={(e) => handlers.handleOpenActionMenu(e, row)}
                onStaleChipClick={() => handlers.handleStaleChipClick(row)}
                hasActionMenu={hasActionMenu}
              />

              <AnomalyExpandedContent
                row={row}
                rowKey={rowKey}
                isExpanded={isExpanded}
                isLast={isLast}
                testRunId={testRunId}
                testRun={testRun}
                trendsData={trendsData[rowKey]}
                trendsLoading={trendsLoading[rowKey] || false}
                chartKey={chartKey[rowKey] || 0}
                drawerOpen={drawerOpen[rowKey] || false}
                drawerData={drawerData[rowKey]}
                drawerLoading={drawerLoading[rowKey] || false}
                showConfigForm={showConfigForm[rowKey] || false}
                showToast={showToast}
                selectedTestRunIdForRow={handlers.selectedTestRunId[rowKey]}
                onDrawerToggle={() => onDrawerToggle(rowKey)}
                onConfigFormToggle={() => onConfigFormToggle(rowKey)}
                onConfigSave={async (rk, data, scope) => handlers.handleConfigSave(rk, data, scope)}
                onSelectTestRun={(id) => handlers.handleSelectTestRun(rowKey, id)}
                onResetSelectedTestRun={() => handlers.handleResetSelectedTestRun(rowKey)}
              />
            </React.Fragment>
          );
        })}
      </Box>

      {/* Pagination Controls */}
      <TablePagination
        component="div"
        count={filteredData.length}
        page={page}
        onPageChange={onPageChange}
        rowsPerPage={rowsPerPage}
        onRowsPerPageChange={onRowsPerPageChange}
        rowsPerPageOptions={[5, 10, 25, 50, 100]}
        sx={(theme) => ({
          borderTop: '1px solid',
          borderColor: alpha(theme.palette.primary.main, 0.15),
          backgroundColor: alpha(theme.palette.action.hover, 0.3),
          '& .MuiTablePagination-toolbar': {
            minHeight: '52px'
          },
          '& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows': {
            fontSize: '0.875rem',
            color: 'text.secondary'
          }
        })}
      />

      {/* Config Save Dialog */}
      <ConfigSaveDialog
        open={handlers.configSaveDialogOpen}
        onClose={handlers.handleConfigSaveDialogClose}
        onSave={handlers.handleConfigSaveDialogChoice}
        loading={handlers.configSaveLoading}
      />

      {/* Delete Anomaly Dialog */}
      <DeleteAnomalyDialog
        open={handlers.deleteDialogOpen}
        onClose={handlers.handleDeleteCancel}
        onConfirm={handlers.handleDeleteConfirm}
        anomalyData={handlers.deleteAnomalyData}
        loading={handlers.deleteLoading}
      />

      {/* Action Menu */}
      <AnomalyActionMenu
        anchorEl={handlers.actionMenuAnchor}
        menuData={handlers.actionMenuData}
        onClose={handlers.handleCloseActionMenu}
        onDelete={handlers.handleDeleteClick}
        hasDistributedTracing={hasDistributedTracing}
        hasDynatrace={hasDynatrace}
        onDrillDownToDistributedTracing={onDrillDownToDistributedTracing}
        onDrillDownToDynatrace={onDrillDownToDynatrace}
        canDelete={Boolean(onDeleteAnomaly)}
      />
    </Box>
  );
}
