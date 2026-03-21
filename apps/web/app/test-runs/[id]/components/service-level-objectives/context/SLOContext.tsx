'use client';

import { createContext, useContext, ReactNode } from 'react';
import { TestRun } from '@/types/test-runs';
import { UseSLOSectionReturn, useSLOSection } from '../hooks/useSLOSection';
import { DrillDownFilters } from '../types/slo.types';

// Extended context that includes props passed to the section
export interface SLOContextValue extends UseSLOSectionReturn {
  // Props from parent
  testRun: TestRun | null;
  testRunId: string;
  sloExpanded: boolean;
  hasDistributedTracing?: boolean;
  hasDynatrace?: boolean;
  onDrillDownToDistributedTracing?: (filters: DrillDownFilters) => void;
  onDrillDownToDynatrace?: (filters: DrillDownFilters) => void;
}

const SLOContext = createContext<SLOContextValue | null>(null);

export interface SLOProviderProps {
  children: ReactNode;
  testRun: TestRun | null;
  testRunId: string;
  sloExpanded: boolean;
  setSloExpanded: (expanded: boolean) => void;
  hasDistributedTracing?: boolean;
  hasDynatrace?: boolean;
  onDrillDownToDistributedTracing?: (filters: DrillDownFilters) => void;
  onDrillDownToDynatrace?: (filters: DrillDownFilters) => void;
}

export function SLOProvider({
  children,
  testRun,
  testRunId,
  sloExpanded,
  setSloExpanded,
  hasDistributedTracing,
  hasDynatrace,
  onDrillDownToDistributedTracing,
  onDrillDownToDynatrace,
}: SLOProviderProps) {
  const sloState = useSLOSection({
    testRun,
    testRunId,
    sloExpanded,
    setSloExpanded,
  });

  const contextValue: SLOContextValue = {
    ...sloState,
    testRun,
    testRunId,
    sloExpanded,
    hasDistributedTracing,
    hasDynatrace,
    onDrillDownToDistributedTracing,
    onDrillDownToDynatrace,
  };

  return (
    <SLOContext.Provider value={contextValue}>
      {children}
    </SLOContext.Provider>
  );
}

export function useSLOContext(): SLOContextValue {
  const context = useContext(SLOContext);
  if (!context) {
    throw new Error('useSLOContext must be used within an SLOProvider');
  }
  return context;
}
