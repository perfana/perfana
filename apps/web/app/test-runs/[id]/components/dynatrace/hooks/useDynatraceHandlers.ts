'use client';

import { useCallback } from 'react';
import { TestRun } from '@/types/test-runs';
import { DynatraceConfig, DynatraceEntity, DynatraceEntityMapping, RelatedTestRun } from '../types';
import {
  buildServiceFilterParam,
  buildDeepLinkUrl,
  buildMDAUrl,
  buildComparisonUrl,
} from '../utils/dynatrace-formatters';

interface UseDynatraceHandlersProps {
  testRun: TestRun;
  configs: DynatraceConfig[];
  selectedMetric: string | null;
  minDuration: string;
  maxDuration: string;
}

export function useDynatraceHandlers({
  testRun,
  configs,
  selectedMetric,
  minDuration,
  maxDuration,
}: UseDynatraceHandlersProps) {
  // Handle deep link click
  const handleDeepLinkClick = useCallback((entity: DynatraceEntity, linkType: string) => {
    if (configs.length === 0) return;

    const config = configs[0];
    const serviceFilterParam = buildServiceFilterParam(
      config,
      testRun.test_run_id,
      selectedMetric,
      minDuration,
      maxDuration
    );

    const url = buildDeepLinkUrl(
      linkType,
      entity,
      config,
      testRun,
      serviceFilterParam ? `&servicefilter=${serviceFilterParam}` : ''
    );

    if (url) {
      window.open(url, '_blank');
    }
  }, [configs, testRun, selectedMetric, minDuration, maxDuration]);

  // Handle multidimensional analysis click
  const handleMultiDimensionalAnalysis = useCallback((entity: DynatraceEntity, analysisType: string) => {
    if (configs.length === 0) return;

    const config = configs[0];
    const serviceFilterParam = buildServiceFilterParam(
      config,
      testRun.test_run_id,
      selectedMetric,
      minDuration,
      maxDuration
    );

    const url = buildMDAUrl(
      analysisType,
      entity,
      config,
      testRun,
      serviceFilterParam
    );

    if (url) {
      window.open(url, '_blank');
    }
  }, [configs, testRun, selectedMetric, minDuration, maxDuration]);

  // Handle comparison click
  const handleComparisonClick = useCallback((
    mapping: DynatraceEntityMapping,
    selectedComparisonTestRun: RelatedTestRun
  ) => {
    if (configs.length === 0 || !selectedComparisonTestRun) return;

    const config = configs[0];
    const url = buildComparisonUrl(
      mapping.entityId,
      config,
      testRun,
      selectedComparisonTestRun,
      selectedMetric,
      minDuration,
      maxDuration
    );

    if (url) {
      window.open(url, '_blank');
    }
  }, [configs, testRun, selectedMetric, minDuration, maxDuration]);

  // Convert entity mapping to DynatraceEntity
  const mappingToEntity = useCallback((mapping: DynatraceEntityMapping): DynatraceEntity => ({
    entityId: mapping.entityId,
    displayName: mapping.entityDisplayName,
    type: mapping.entityType,
  }), []);

  return {
    handleDeepLinkClick,
    handleMultiDimensionalAnalysis,
    handleComparisonClick,
    mappingToEntity,
  };
}
