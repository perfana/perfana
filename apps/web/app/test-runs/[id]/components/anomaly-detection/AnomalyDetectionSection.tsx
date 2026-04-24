import React, { useRef } from 'react';
import { TestRun } from '@/types/test-runs';
import AnomalyDetectionCollapsedCard from './components/AnomalyDetectionCollapsedCard';
import AnomalyDetectionExpandedCard from './components/AnomalyDetectionExpandedCard';
import { useAnomalyDetection } from './hooks';

interface DrillDownFilters {
  scenario?: string;
  transaction?: string;
  sampler?: string;
}

interface AnomalyDetectionSectionProps {
  testRun: TestRun | null;
  testRunId: string;
  anomalyExpanded: boolean;
  onAnomalyExpand: (tabIndex?: number) => void;
  activeTab?: number;
  onActiveTabChange?: (tabIndex: number) => void;
  conclusionFilter: string;
  setConclusionFilter: (value: string) => void;
  showToast: (message: string) => void;
  onTestRunUpdate?: (updatedTestRun: TestRun) => void;
  // Drill-down functionality
  hasDistributedTracing?: boolean;
  hasDynatrace?: boolean;
  onDrillDownToDistributedTracing?: (filters: DrillDownFilters) => void;
  onDrillDownToDynatrace?: (filters: DrillDownFilters) => void;
}

export default function AnomalyDetectionSection({
  testRun,
  testRunId,
  anomalyExpanded,
  onAnomalyExpand,
  activeTab: parentActiveTab,
  onActiveTabChange,
  conclusionFilter,
  setConclusionFilter,
  showToast,
  onTestRunUpdate,
  hasDistributedTracing = false,
  hasDynatrace = false,
  onDrillDownToDistributedTracing,
  onDrillDownToDynatrace,
}: AnomalyDetectionSectionProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  const {
    // Data state
    anomalyData,
    loading,
    error,
    dsAdaptConclusion,
    trackedCount,
    // Tab state
    activeTab,
    setActiveTab,
    // Filter & pagination state
    page,
    setPage,
    rowsPerPage,
    setRowsPerPage,
    searchQuery,
    setSearchQuery,
    classificationFilter,
    setClassificationFilter,
    dashboardFilter,
    _setDashboardFilter,
    panelFilter,
    _setPanelFilter,
    // Sort state
    sortBy,
    sortDirection,
    diffSortMode,
    handleSortChange,
    handleDiffSortModeChange,
    // Row state
    expandedRows,
    trendsData,
    trendsLoading,
    // Drawer state
    drawerOpen,
    drawerData,
    drawerLoading,
    chartKey,
    // Config form state
    showConfigForm,
    configFormData,
    // Derived data
    filteredData,
    paginatedData,
    conclusionsForDropdown,
    classificationsForDropdown,
    dashboardsForDropdown,
    panelsForDropdown,
    // Ref
    pendingConclusionRef,
    // Handlers
    handleExpand,
    handleCollapse,
    handleRowToggle,
    handleDrawerToggle,
    handleConfigFormToggle,
    handleConfigSave,
    handleDeleteAnomaly,
    handleAcceptResults,
    handleDenyResults,
    updateAdaptConfig,
    disableBaselineMode,
    fetchAnomalyData,
    handleConclusionFilterChange,
    handleSearchChange,
    handleConclusionFilterForForm,
    handleClassificationFilterChange,
    handleDashboardFilterChange,
    handlePanelFilterChange,
  } = useAnomalyDetection({
    testRun,
    testRunId,
    anomalyExpanded,
    onAnomalyExpand,
    parentActiveTab,
    onActiveTabChange,
    conclusionFilter,
    setConclusionFilter,
    showToast,
    onTestRunUpdate,
    cardRef,
  });

  if (!anomalyExpanded) {
    return (
      <AnomalyDetectionCollapsedCard
        data={anomalyData}
        loading={loading}
        conclusionFilter={conclusionFilter}
        setConclusionFilter={handleConclusionFilterChange}
        onExpand={handleExpand}
        testRun={testRun}
        dsAdaptConclusion={dsAdaptConclusion}
      />
    );
  }

  return (
    <AnomalyDetectionExpandedCard
      testRun={testRun}
      testRunId={testRunId}
      data={anomalyData}
      loading={loading}
      error={error}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      trackedCount={trackedCount}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      conclusionFilter={conclusionFilter}
      onConclusionFilterChange={setConclusionFilter}
      classificationFilter={classificationFilter}
      onClassificationFilterChange={setClassificationFilter}
      page={page}
      rowsPerPage={rowsPerPage}
      onPageChange={(_, newPage) => setPage(newPage)}
      onRowsPerPageChange={(e) => setRowsPerPage(parseInt(e.target.value, 10))}
      expandedRows={expandedRows}
      onRowToggle={handleRowToggle}
      drawerOpen={drawerOpen}
      onDrawerToggle={handleDrawerToggle}
      drawerData={drawerData}
      drawerLoading={drawerLoading}
      trendsData={trendsData}
      trendsLoading={trendsLoading}
      chartKey={chartKey}
      showConfigForm={showConfigForm}
      onConfigFormToggle={handleConfigFormToggle}
      configFormData={configFormData}
      onConfigSave={handleConfigSave}
      onAcceptResults={handleAcceptResults}
      onDenyResults={handleDenyResults}
      updateAdaptConfig={updateAdaptConfig}
      disableBaselineMode={disableBaselineMode}
      onCollapse={handleCollapse}
      showToast={showToast}
      onRefreshAnomalyData={fetchAnomalyData}
      onDeleteAnomaly={handleDeleteAnomaly}
      pendingConclusionRef={pendingConclusionRef}
      cardRef={cardRef}
      conclusionsForDropdown={conclusionsForDropdown}
      classificationsForDropdown={classificationsForDropdown}
      filteredData={filteredData}
      handleSearchChange={handleSearchChange}
      handleConclusionFilterChange={handleConclusionFilterForForm}
      handleClassificationFilterChange={handleClassificationFilterChange}
      dashboardFilter={dashboardFilter}
      handleDashboardFilterChange={handleDashboardFilterChange}
      panelFilter={panelFilter}
      handlePanelFilterChange={handlePanelFilterChange}
      dashboardsForDropdown={dashboardsForDropdown}
      panelsForDropdown={panelsForDropdown}
      paginatedData={paginatedData}
      toggleRowExpanded={handleRowToggle}
      sortBy={sortBy}
      sortDirection={sortDirection}
      diffSortMode={diffSortMode}
      onSortChange={handleSortChange}
      onDiffSortModeChange={handleDiffSortModeChange}
      hasDistributedTracing={hasDistributedTracing}
      hasDynatrace={hasDynatrace}
      onDrillDownToDistributedTracing={onDrillDownToDistributedTracing}
      onDrillDownToDynatrace={onDrillDownToDynatrace}
    />
  );
}
