import { useState, useCallback } from 'react';
import { authenticatedFetch } from '@/lib/api';
import { TestRun } from '@/types/test-runs';
import { ConfigurationStatus } from '../types';

interface UseConfigurationStatusReturn {
  configurationStatus: ConfigurationStatus;
  setHasDistributedTracing: (value: boolean) => void;
  setHasDynatrace: (value: boolean) => void;
  checkConfigurationStatus: (testRun: TestRun) => Promise<void>;
}

/**
 * Hook for managing configuration status checks for drill-down options
 */
export function useConfigurationStatus(): UseConfigurationStatusReturn {
  const [configurationStatus, setConfigurationStatus] = useState<ConfigurationStatus>({
    hasDistributedTracing: false,
    hasDynatrace: false,
  });

  const setHasDistributedTracing = useCallback((value: boolean) => {
    setConfigurationStatus(prev => ({ ...prev, hasDistributedTracing: value }));
  }, []);

  const setHasDynatrace = useCallback((value: boolean) => {
    setConfigurationStatus(prev => ({ ...prev, hasDynatrace: value }));
  }, []);

  const checkConfigurationStatus = useCallback(async (testRun: TestRun) => {
    try {
      // Check Distributed Tracing configuration
      const tracingParams = new URLSearchParams({
        systemId: testRun.system_under_test_id,
        environment: testRun.test_environment,
        workload: testRun.workload,
      });
      const tracingResponse = await authenticatedFetch(`/tracing-services?${tracingParams.toString()}`);
      if (tracingResponse.ok) {
        const tracingServices = await tracingResponse.json();
        setConfigurationStatus(prev => ({
          ...prev,
          hasDistributedTracing: Array.isArray(tracingServices) && tracingServices.length > 0,
        }));
      }

      // Check Dynatrace configuration
      const dynatraceConfigResponse = await authenticatedFetch('/dynatrace');
      if (dynatraceConfigResponse.ok) {
        const dynatraceConfigs = await dynatraceConfigResponse.json();
        if (dynatraceConfigs && dynatraceConfigs.length > 0) {
          // Fetch entity mappings to confirm Dynatrace is configured for this test run
          const mappingsResponse = await authenticatedFetch(
            `/dynatrace/entities/mappings?systemId=${testRun.system_under_test_id}&environment=${testRun.test_environment}&workload=${testRun.workload}`
          );
          if (mappingsResponse.ok) {
            const mappings = await mappingsResponse.json();
            setConfigurationStatus(prev => ({
              ...prev,
              hasDynatrace: Array.isArray(mappings) && mappings.length > 0,
            }));
          }
        }
      }
    } catch (error) {
      console.error('Failed to check configuration status:', error);
    }
  }, []);

  return {
    configurationStatus,
    setHasDistributedTracing,
    setHasDynatrace,
    checkConfigurationStatus,
  };
}
