'use client';

import React, { createContext, useContext, ReactNode } from 'react';
import { TestRun } from '@/types/test-runs';

export interface CompleteTestRunData {
  testRun: TestRun;
  relatedTestRuns: unknown[];
  configs: unknown[];
  expectedConfigChanges: unknown[];
  applicationDashboards: unknown[];
  anomalyDetection: unknown | null;
  checkResults: unknown | null;
}

interface TestRunDataContextType {
  data: CompleteTestRunData | null;
  loading: boolean;
  error: string | null;
}

const TestRunDataContext = createContext<TestRunDataContextType | undefined>(undefined);

export function useTestRunData() {
  const context = useContext(TestRunDataContext);
  if (context === undefined) {
    throw new Error('useTestRunData must be used within a TestRunDataProvider');
  }
  return context;
}

interface TestRunDataProviderProps {
  children: ReactNode;
  data: CompleteTestRunData | null;
  loading: boolean;
  error: string | null;
}

export function TestRunDataProvider({
  children,
  data,
  loading,
  error,
}: TestRunDataProviderProps) {
  return (
    <TestRunDataContext.Provider value={{ data, loading, error }}>
      {children}
    </TestRunDataContext.Provider>
  );
}