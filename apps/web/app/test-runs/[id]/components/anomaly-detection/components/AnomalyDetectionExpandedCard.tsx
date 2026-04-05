'use client';

import React from 'react';
import {
  Card,
  CardContent,
  Box,
  Tabs,
  Tab
} from '@mui/material';
import {
  ExpandedCardHeader,
  AnomalyTabContent,
  TrackedRegressionsTabContent,
} from './expanded-card/components';
import { useExpandedCardActions } from './expanded-card/hooks';
import { calculateFeedbackState } from './expanded-card/utils';
import type { AnomalyDetectionExpandedCardProps } from './expanded-card/types';

export type { AnomalyDetectionExpandedCardProps };

export default function AnomalyDetectionExpandedCard(props: AnomalyDetectionExpandedCardProps) {
  const {
    testRun,
    data: anomalyData,
    loading,
    searchQuery,
    conclusionFilter,
    classificationFilter,
    dashboardFilter,
    panelFilter,
    filteredData,
    handleSearchChange,
    handleConclusionFilterChange,
    handleClassificationFilterChange,
    handleDashboardFilterChange,
    handlePanelFilterChange,
    conclusionsForDropdown,
    classificationsForDropdown,
    dashboardsForDropdown,
    panelsForDropdown,
    onCollapse,
    updateAdaptConfig,
    showToast,
    cardRef,
    testRunId,
    paginatedData,
    toggleRowExpanded,
    expandedRows,
    trendsData,
    trendsLoading,
    chartKey,
    drawerOpen,
    onDrawerToggle,
    drawerData,
    drawerLoading,
    showConfigForm,
    configFormData,
    onConfigFormToggle,
    onConfigSave,
    activeTab,
    onTabChange,
    page,
    rowsPerPage,
    onPageChange,
    onRowsPerPageChange,
    onRefreshAnomalyData,
    onDeleteAnomaly,
    hasDistributedTracing,
    hasDynatrace,
    onDrillDownToDistributedTracing,
    onDrillDownToDynatrace,
  } = props;

  // Get actions from hook
  const {
    markAsChangepoint,
    handleMarkAsRegression,
    handleMarkAsVariability,
  } = useExpandedCardActions({
    testRun,
    testRunId,
    showToast,
    updateAdaptConfig,
  });

  // Calculate feedback state
  const feedbackState = calculateFeedbackState(testRun, anomalyData, loading);

  // Handle tab change
  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    onTabChange(newValue);
  };

  return (
    <Card
      ref={cardRef}
      tabIndex={-1}
      data-testid="anomaly-detection-section-expanded"
      elevation={0}
      sx={(theme) => ({
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 3,
        backgroundColor: theme.palette.background.paper,
        overflow: 'visible',
        mb: 3
      })}
    >
      <CardContent sx={{ p: 0 }}>
        <ExpandedCardHeader onCollapse={onCollapse} />

        {/* Tabs */}
        <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
          <Tabs value={activeTab} onChange={handleTabChange} aria-label="anomaly detection tabs">
            <Tab
              label="Anomaly Detection"
              sx={{ minHeight: 48, textTransform: 'none', fontWeight: 600 }}
            />
            <Tab
              label="Unresolved Regressions"
              sx={{ minHeight: 48, textTransform: 'none', fontWeight: 600 }}
            />
          </Tabs>
        </Box>

        {/* Tab Content */}
        {activeTab === 0 && (
          <AnomalyTabContent
            loading={loading}
            anomalyData={anomalyData}
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
            feedbackState={feedbackState}
            onMarkAsRegression={handleMarkAsRegression}
            onMarkAsVariability={handleMarkAsVariability}
            onMarkAsChangepoint={markAsChangepoint}
            onDisableBaselineMode={props.disableBaselineMode}
            paginatedData={paginatedData}
            page={page}
            rowsPerPage={rowsPerPage}
            onPageChange={onPageChange}
            onRowsPerPageChange={onRowsPerPageChange}
            expandedRows={expandedRows}
            toggleRowExpanded={toggleRowExpanded}
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
          />
        )}

        {activeTab === 1 && (
          <TrackedRegressionsTabContent
            testRunId={testRunId}
            testRun={testRun}
            trendsData={trendsData}
            onRefreshAnomalyData={onRefreshAnomalyData}
            showToast={showToast}
          />
        )}
      </CardContent>
    </Card>
  );
}
