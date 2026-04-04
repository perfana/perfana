import { useState, useCallback } from 'react';
import { ExpansionState, AnomalyState, DrillDownFilters } from '../types';

interface UseExpansionStateReturn {
  expansionState: ExpansionState;
  anomalyState: AnomalyState;
  drillDownFilters: {
    distributedTracing: DrillDownFilters | undefined;
    dynatrace: DrillDownFilters | undefined;
  };
  toggleExpansion: (key: keyof ExpansionState) => void;
  setExpansion: (key: keyof ExpansionState, value: boolean) => void;
  setAnomalyActiveTab: (tab: number) => void;
  setAnomalyConclusionFilter: (filter: string) => void;
  handleAnomalyExpand: (tabIndex?: number) => boolean;
  handleDrillDownToDistributedTracing: (filters: DrillDownFilters, activeTab: number, setActiveTab: (tab: number) => void) => boolean;
  handleDrillDownToDynatrace: (filters: DrillDownFilters, activeTab: number, setActiveTab: (tab: number) => void) => boolean;
}

/**
 * Scroll card into view after expansion
 * Uses retry logic for cross-tab navigation where content may not be immediately available
 */
export function scrollToCard(testId: string, options?: { delay?: number; maxRetries?: number }): void {
  const { delay = 100, maxRetries = 5 } = options || {};
  let attempts = 0;

  const attemptScroll = () => {
    const card = document.querySelector(`[data-testid="${testId}"]`);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      (card as HTMLElement).focus({ preventScroll: true });
    } else if (attempts < maxRetries) {
      attempts++;
      setTimeout(attemptScroll, delay);
    }
  };

  setTimeout(attemptScroll, delay);
}

/**
 * Hook for managing all expansion states in the test run details page
 */
export function useExpansionState(): UseExpansionStateReturn {
  const [expansionState, setExpansionState] = useState<ExpansionState>({
    expanded: false,
    configExpanded: false,
    sloExpanded: false,
    anomalyExpanded: false,
    dashboardsExpanded: false,
    trendsExpanded: false,
    deepLinksExpanded: false,
    dynatraceExpanded: false,
    distributedTracingExpanded: false,
    pyroscopeExpanded: false,
    compareExpanded: false,
    performanceExpanded: false,
    graphsExpanded: false,
    awrExpanded: false,
    reportExpanded: false,
    eventsExpanded: false,
    scalingProgressionExpanded: false,
  });

  const [anomalyState, setAnomalyState] = useState<AnomalyState>({
    activeTab: 0,
    conclusionFilter: 'all',
  });

  const [distributedTracingFilters, setDistributedTracingFilters] = useState<DrillDownFilters | undefined>(undefined);
  const [dynatraceFilters, setDynatraceFilters] = useState<DrillDownFilters | undefined>(undefined);

  const toggleExpansion = useCallback((key: keyof ExpansionState) => {
    setExpansionState(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const setExpansion = useCallback((key: keyof ExpansionState, value: boolean) => {
    setExpansionState(prev => ({ ...prev, [key]: value }));
  }, []);

  const setAnomalyActiveTab = useCallback((tab: number) => {
    setAnomalyState(prev => ({ ...prev, activeTab: tab }));
  }, []);

  const setAnomalyConclusionFilter = useCallback((filter: string) => {
    setAnomalyState(prev => ({ ...prev, conclusionFilter: filter }));
  }, []);

  // Handler for anomaly section expansion with optional tab pre-selection
  // Returns true if the card was expanded (for scroll handling)
  const handleAnomalyExpand = useCallback((tabIndex?: number): boolean => {
    const wasCollapsed = !expansionState.anomalyExpanded;
    if (tabIndex !== undefined) {
      setAnomalyState(prev => ({ ...prev, activeTab: tabIndex }));
    }
    setExpansionState(prev => ({ ...prev, anomalyExpanded: !prev.anomalyExpanded }));
    return wasCollapsed;
  }, [expansionState.anomalyExpanded]);

  // Handler for drill-down to Distributed Tracing card
  // Returns true if tab switch was needed (for determining scroll delay)
  const handleDrillDownToDistributedTracing = useCallback(
    (filters: DrillDownFilters, activeTab: number, setActiveTab: (tab: number) => void): boolean => {
      setDistributedTracingFilters(filters);
      const needsTabSwitch = activeTab !== 1;
      setActiveTab(1);
      if (!expansionState.distributedTracingExpanded) {
        setExpansionState(prev => ({ ...prev, distributedTracingExpanded: true }));
      }
      return needsTabSwitch;
    },
    [expansionState.distributedTracingExpanded]
  );

  // Handler for drill-down to Dynatrace card
  // Returns true if tab switch was needed (for determining scroll delay)
  const handleDrillDownToDynatrace = useCallback(
    (filters: DrillDownFilters, activeTab: number, setActiveTab: (tab: number) => void): boolean => {
      setDynatraceFilters(filters);
      const needsTabSwitch = activeTab !== 1;
      setActiveTab(1);
      if (!expansionState.dynatraceExpanded) {
        setExpansionState(prev => ({ ...prev, dynatraceExpanded: true }));
      }
      return needsTabSwitch;
    },
    [expansionState.dynatraceExpanded]
  );

  return {
    expansionState,
    anomalyState,
    drillDownFilters: {
      distributedTracing: distributedTracingFilters,
      dynatrace: dynatraceFilters,
    },
    toggleExpansion,
    setExpansion,
    setAnomalyActiveTab,
    setAnomalyConclusionFilter,
    handleAnomalyExpand,
    handleDrillDownToDistributedTracing,
    handleDrillDownToDynatrace,
  };
}
