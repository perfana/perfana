'use client';

import React from 'react';
import {
  Box,
  Card,
  CardContent,
  Divider,
  Collapse,
} from '@mui/material';

// Types
import { ServiceLevelObjectivesSectionProps } from './types';

// Hooks
import { useSLOSection } from './hooks';

// Components
import { SLOCollapsedView, SLOExpandedView, SLODialogs, SLOCollapsedHeader, SLOExpandedHeader } from './components';

export default function ServiceLevelObjectivesSection({
  testRun,
  testRunId,
  sloExpanded,
  setSloExpanded,
  hasDistributedTracing = false,
  hasDynatrace = false,
  onDrillDownToDistributedTracing,
  onDrillDownToDynatrace
}: ServiceLevelObjectivesSectionProps) {
  // Use the extracted hook for all state management
  const sloSection = useSLOSection({
    testRun,
    testRunId,
    sloExpanded,
    setSloExpanded,
  });

  const {
    checkResults,
    checkResultsLoading,
    benchmarks,
    benchmarksLoading,
    accentColor,
    cardRef,
    handleSloExpand,
  } = sloSection;

  return (
    <Box sx={{
      ...(sloExpanded ? {
        flex: '1 1 100% !important',
        minWidth: 'unset'
      } : {})
    }}>
      <Card
        ref={cardRef}
        tabIndex={-1}
        data-testid={sloExpanded ? 'slo-section-expanded' : 'slo-section-collapsed'}
        elevation={0}
        sx={{
          cursor: sloExpanded ? 'default' : 'pointer',
          height: sloExpanded ? 'auto' : '293px',
          borderRadius: 3,
          bgcolor: 'background.paper',
          border: sloExpanded ? '1px solid' : 'none',
          borderColor: sloExpanded ? 'divider' : undefined,
          borderTop: sloExpanded ? undefined : `3px solid ${accentColor}`,
          boxShadow: (theme) => sloExpanded
            ? theme.palette.mode === 'dark'
              ? '0 4px 12px rgba(0, 0, 0, 0.2), 0 2px 4px rgba(0, 0, 0, 0.15)'
              : '0 4px 12px rgba(0, 0, 0, 0.05), 0 2px 4px rgba(0, 0, 0, 0.02)'
            : theme.palette.mode === 'dark'
              ? '0 1px 3px rgba(0, 0, 0, 0.3), 0 4px 12px rgba(0, 0, 0, 0.2)'
              : '0 1px 3px rgba(0, 0, 0, 0.08), 0 4px 12px rgba(0, 0, 0, 0.04)',
          transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          position: 'relative',
          overflow: sloExpanded ? 'visible' : 'hidden',
          '&:hover': sloExpanded ? {} : {
            transform: 'translateY(-4px)',
            boxShadow: (theme) => theme.palette.mode === 'dark'
              ? '0 4px 12px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.3)'
              : '0 4px 12px rgba(0, 0, 0, 0.1), 0 8px 24px rgba(0, 0, 0, 0.08)',
          }
        }}
        onClick={sloExpanded ? undefined : handleSloExpand}
      >
        <CardContent sx={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          p: sloExpanded ? 2 : 3,
          '&:last-child': { pb: sloExpanded ? 2 : 3 }
        }}>

          {/* Header - Collapsed State */}
          {!sloExpanded ? (
            <SLOCollapsedHeader
              accentColor={accentColor}
              onExpand={handleSloExpand}
            />
          ) : (
            <SLOExpandedHeader
              testRun={testRun}
              onCollapse={handleSloExpand}
            />
          )}

          {/* Collapsed View Content */}
          {!sloExpanded && (
            <SLOCollapsedView
              checkResults={checkResults}
              checkResultsLoading={checkResultsLoading}
              benchmarks={benchmarks}
              benchmarksLoading={benchmarksLoading}
              testRun={testRun}
            />
          )}

          {/* Expanded Content */}
          <Collapse in={sloExpanded}>
            <Divider sx={{ my: 2 }} />
            <SLOExpandedView
              testRun={testRun}
              testRunId={testRunId}
              checkResults={sloSection.checkResults}
              checkResultsLoading={sloSection.checkResultsLoading}
              benchmarks={sloSection.benchmarks}
              benchmarksLoading={sloSection.benchmarksLoading}
              expandedSloRows={sloSection.expandedSloRows}
              sloFilter={sloSection.sloFilter}
              searchText={sloSection.searchText}
              sortConfig={sloSection.sortConfig}
              selectedTarget={sloSection.selectedTarget}
              setSelectedTarget={sloSection.setSelectedTarget}
              expandedTransactions={sloSection.expandedTransactions}
              transactionSamples={sloSection.transactionSamples}
              loadingTransactionSamples={sloSection.loadingTransactionSamples}
              transactionSamplesError={sloSection.transactionSamplesError}
              hasDistributedTracing={hasDistributedTracing}
              hasDynatrace={hasDynatrace}
              toggleSloRow={sloSection.toggleSloRow}
              handleSort={sloSection.handleSort}
              setSloFilter={sloSection.setSloFilter}
              setIsFilterManuallySet={sloSection.setIsFilterManuallySet}
              setSearchText={sloSection.setSearchText}
              toggleTransactionExpanded={sloSection.toggleTransactionExpanded}
              handleOpenRequestActionMenu={sloSection.handleOpenRequestActionMenu}
              handleOpenApdexActionMenu={sloSection.handleOpenApdexActionMenu}
              handleEditSlo={sloSection.handleEditSlo}
              handleReEvaluate={sloSection.handleReEvaluate}
              handleOpenApdexThresholdsDialog={sloSection.handleOpenApdexThresholdsDialog}
              getCheckResultKey={sloSection.getCheckResultKey}
            />
          </Collapse>
        </CardContent>
      </Card>

      {/* Dialogs and Menus */}
      <SLODialogs
        testRun={testRun}
        testRunId={testRunId}
        hasDistributedTracing={hasDistributedTracing}
        hasDynatrace={hasDynatrace}
        onDrillDownToDistributedTracing={onDrillDownToDistributedTracing}
        onDrillDownToDynatrace={onDrillDownToDynatrace}
        editSloDialogOpen={sloSection.editSloDialogOpen}
        selectedSloForEdit={sloSection.selectedSloForEdit}
        setEditSloDialogOpen={sloSection.setEditSloDialogOpen}
        setSelectedSloForEdit={sloSection.setSelectedSloForEdit}
        handleSloUpdated={sloSection.handleSloUpdated}
        apdexActionMenuAnchor={sloSection.apdexActionMenuAnchor}
        apdexActionMenuData={sloSection.apdexActionMenuData}
        handleCloseApdexActionMenu={sloSection.handleCloseApdexActionMenu}
        setSelectedTransactionForApdex={sloSection.setSelectedTransactionForApdex}
        setApdexConfigDialogOpen={sloSection.setApdexConfigDialogOpen}
        requestActionMenuAnchor={sloSection.requestActionMenuAnchor}
        requestActionMenuData={sloSection.requestActionMenuData}
        handleCloseRequestActionMenu={sloSection.handleCloseRequestActionMenu}
        apdexConfigDialogOpen={sloSection.apdexConfigDialogOpen}
        selectedTransactionForApdex={sloSection.selectedTransactionForApdex}
        handleApdexConfigSuccess={sloSection.handleApdexConfigSuccess}
        apdexThresholdsDialogOpen={sloSection.apdexThresholdsDialogOpen}
        selectedApdexResultForThresholds={sloSection.selectedApdexResultForThresholds}
        setApdexThresholdsDialogOpen={sloSection.setApdexThresholdsDialogOpen}
        setSelectedApdexResultForThresholds={sloSection.setSelectedApdexResultForThresholds}
        handleApdexThresholdsSuccess={sloSection.handleApdexThresholdsSuccess}
      />
    </Box>
  );
}
