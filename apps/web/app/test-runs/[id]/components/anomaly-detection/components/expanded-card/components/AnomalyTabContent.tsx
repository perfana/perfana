'use client';

import React from 'react';
import { Box, Typography, CircularProgress } from '@mui/material';
import FilterControls from '../../FilterControls';
import AnomalyDetectionTable from '../../AnomalyDetectionTable';
import { FeedbackBanner } from './FeedbackBanner';
import type { AnomalyTabContentProps } from '../types';

/**
 * Content component for the Anomaly Detection tab.
 * Displays loading state, empty state, or the full anomaly detection interface.
 */
export function AnomalyTabContent({
  loading,
  anomalyData,
  searchQuery,
  handleSearchChange,
  conclusionFilter,
  handleConclusionFilterChange,
  classificationFilter,
  handleClassificationFilterChange,
  dashboardFilter,
  handleDashboardFilterChange,
  panelFilter,
  handlePanelFilterChange,
  conclusionsForDropdown,
  classificationsForDropdown,
  dashboardsForDropdown,
  panelsForDropdown,
  filteredData,
  feedbackState,
  onMarkAsRegression,
  onMarkAsVariability,
  onMarkAsChangepoint,
  onDisableBaselineMode,
  paginatedData,
  page,
  rowsPerPage,
  onPageChange,
  onRowsPerPageChange,
  expandedRows,
  toggleRowExpanded,
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
  showConfigForm,
  configFormData,
  onConfigFormToggle,
  onConfigSave,
  onRefreshAnomalyData,
  onDeleteAnomaly,
  hasDistributedTracing,
  hasDynatrace,
  onDrillDownToDistributedTracing,
  onDrillDownToDynatrace,
  sortBy,
  sortDirection,
  diffSortMode,
  onSortChange,
  onDiffSortModeChange,
}: AnomalyTabContentProps) {
  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" py={4}>
        <CircularProgress />
      </Box>
    );
  }

  if (anomalyData.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" textAlign="center" py={4}>
        No anomaly detection data available for this test run.
      </Typography>
    );
  }

  return (
    <>
      <FilterControls
        searchQuery={searchQuery}
        handleSearchChange={handleSearchChange}
        conclusionFilter={conclusionFilter}
        handleConclusionFilterChange={handleConclusionFilterChange}
        classificationFilter={classificationFilter}
        handleClassificationFilterChange={handleClassificationFilterChange}
        dashboardFilter={dashboardFilter}
        handleDashboardFilterChange={handleDashboardFilterChange}
        panelFilter={panelFilter}
        handlePanelFilterChange={handlePanelFilterChange}
        conclusionsForDropdown={conclusionsForDropdown}
        classificationsForDropdown={classificationsForDropdown}
        dashboardsForDropdown={dashboardsForDropdown}
        panelsForDropdown={panelsForDropdown}
        filteredData={filteredData}
        anomalyData={anomalyData}
      />

      <FeedbackBanner
        feedbackState={feedbackState}
        isBaselineMode={testRun?.adapt_config?.mode === 'BASELINE'}
        onDisableBaselineMode={onDisableBaselineMode}
        onMarkAsRegression={onMarkAsRegression}
        onMarkAsVariability={onMarkAsVariability}
        onMarkAsChangepoint={onMarkAsChangepoint}
      />

      <AnomalyDetectionTable
        paginatedData={paginatedData}
        filteredData={filteredData}
        expandedRows={expandedRows}
        toggleRowExpanded={toggleRowExpanded}
        page={page}
        rowsPerPage={rowsPerPage}
        onPageChange={onPageChange}
        onRowsPerPageChange={onRowsPerPageChange}
        testRunId={testRunId}
        testRun={testRun}
        trendsData={trendsData}
        trendsLoading={trendsLoading}
        chartKey={chartKey}
        drawerOpen={drawerOpen}
        onDrawerToggle={onDrawerToggle}
        drawerData={drawerData}
        drawerLoading={drawerLoading}
        showToast={showToast}
        showConfigForm={showConfigForm}
        configFormData={configFormData}
        onConfigFormToggle={onConfigFormToggle}
        onConfigSave={onConfigSave}
        onRefreshAnomalyData={onRefreshAnomalyData}
        onDeleteAnomaly={onDeleteAnomaly}
        hasDistributedTracing={hasDistributedTracing}
        hasDynatrace={hasDynatrace}
        onDrillDownToDistributedTracing={onDrillDownToDistributedTracing}
        onDrillDownToDynatrace={onDrillDownToDynatrace}
        sortBy={sortBy}
        sortDirection={sortDirection}
        diffSortMode={diffSortMode}
        onSortChange={onSortChange}
        onDiffSortModeChange={onDiffSortModeChange}
      />
    </>
  );
}
