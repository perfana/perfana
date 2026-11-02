import { useState, useCallback } from 'react';
import { ExpansionState, AnomalyState, DrillDownFilters } from '../types';

interface UseExpansionStateReturn {
  expansionState: ExpansionState;
  anomalyState: AnomalyState;
  drillDownFilters: {
    distributedTracing: DrillDownFilters | undefined;
    dynatrace: DrillDownFilters | undefined;
  };
  /** Bumped per drill-down; the RCA cards are keyed on it. */
  drillDownSeq: { distributedTracing: number; dynatrace: number };
  toggleExpansion: (key: keyof ExpansionState) => void;
  setExpansion: (key: keyof ExpansionState, value: boolean) => void;
  collapseTab: (tab: TabIndex) => void;
  setAnomalyActiveTab: (tab: number) => void;
  setAnomalyConclusionFilter: (filter: string) => void;
  handleAnomalyExpand: (tabIndex?: number) => boolean;
  handleDrillDownToDistributedTracing: (filters: DrillDownFilters, activeTab: TabIndex, setActiveTab: (tab: TabIndex) => void) => boolean;
  handleDrillDownToDynatrace: (filters: DrillDownFilters, activeTab: TabIndex, setActiveTab: (tab: TabIndex) => void) => boolean;
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

/** Tab indices of the test run details page, in the order its <Tab>s render. */
export const TAB = { results: 0, rca: 1, reporting: 2 } as const;
export type TabIndex = (typeof TAB)[keyof typeof TAB];

/**
 * The cards each tab renders: a re-click of the active tab collapses exactly these, and a link
 * into a card switches to the tab that lists it. Must match the tab panels in page.tsx, which
 * render each card by hand: collapseTab and revealCard both trust this list.
 */
export const TAB_CARDS: Record<TabIndex, (keyof ExpansionState)[]> = {
  [TAB.results]: ['expanded', 'configExpanded', 'dashboardsExpanded', 'anomalyExpanded', 'performanceExpanded', 'sloExpanded', 'deepLinksExpanded', 'eventsExpanded'],
  [TAB.rca]: ['dynatraceExpanded', 'distributedTracingExpanded', 'pyroscopeExpanded', 'awrExpanded'],
  [TAB.reporting]: ['reportExpanded', 'trendsExpanded', 'compareExpanded', 'graphsExpanded'],
};

export function tabOfCard(key: keyof ExpansionState): TabIndex {
  return (Object.values(TAB) as TabIndex[]).find((tab) => TAB_CARDS[tab].includes(key)) ?? TAB.results;
}

const ALL_COLLAPSED: ExpansionState = {
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
};

/**
 * Hook for managing all expansion states in the test run details page
 */
export function useExpansionState(): UseExpansionStateReturn {
  const [expansionState, setExpansionState] = useState<ExpansionState>(ALL_COLLAPSED);

  const [anomalyState, setAnomalyState] = useState<AnomalyState>({
    activeTab: 0,
    conclusionFilter: 'all',
  });

  const [distributedTracingFilters, setDistributedTracingFilters] = useState<DrillDownFilters | undefined>(undefined);
  const [dynatraceFilters, setDynatraceFilters] = useState<DrillDownFilters | undefined>(undefined);
  // Visited tabs stay mounted, so a drill-down no longer lands on a fresh card by itself. The
  // cards' filter effects only overwrite fields that match, so a reused card would carry the
  // previous drill-down's sampler and durations; keying the card on this restores a fresh mount.
  const [drillDownSeq, setDrillDownSeq] = useState({ distributedTracing: 0, dynatrace: 0 });

  const toggleExpansion = useCallback((key: keyof ExpansionState) => {
    setExpansionState(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const setExpansion = useCallback((key: keyof ExpansionState, value: boolean) => {
    setExpansionState(prev => ({ ...prev, [key]: value }));
  }, []);

  const collapseTab = useCallback((tab: TabIndex) => {
    setExpansionState(prev => ({ ...prev, ...Object.fromEntries(TAB_CARDS[tab].map(key => [key, false])) }));
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
    (filters: DrillDownFilters, activeTab: TabIndex, setActiveTab: (tab: TabIndex) => void): boolean => {
      setDistributedTracingFilters(filters);
      setDrillDownSeq(prev => ({ ...prev, distributedTracing: prev.distributedTracing + 1 }));
      const needsTabSwitch = activeTab !== TAB.rca;
      setActiveTab(TAB.rca);
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
    (filters: DrillDownFilters, activeTab: TabIndex, setActiveTab: (tab: TabIndex) => void): boolean => {
      setDynatraceFilters(filters);
      setDrillDownSeq(prev => ({ ...prev, dynatrace: prev.dynatrace + 1 }));
      const needsTabSwitch = activeTab !== TAB.rca;
      setActiveTab(TAB.rca);
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
    drillDownSeq,
    toggleExpansion,
    setExpansion,
    collapseTab,
    setAnomalyActiveTab,
    setAnomalyConclusionFilter,
    handleAnomalyExpand,
    handleDrillDownToDistributedTracing,
    handleDrillDownToDynatrace,
  };
}
