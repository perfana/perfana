'use client';

import { useState, useEffect, useCallback } from 'react';
import { DashboardTile } from '../types';
import { DynatraceConfig, fetchDynatraceConfigs } from '../../../../../../../lib/dynatrace';
import { parseDashboardFile, initializeVariableValues } from '../utils';

interface UseImportDashboardProps {
  open: boolean;
  onImport: (
    tiles: DashboardTile[],
    variableValues: Record<string, string>,
    dashboardName: string,
    metricUnit: string,
    dynatraceConfigId: string
  ) => void;
}

interface UseImportDashboardReturn {
  // Dynatrace configs state
  dynatraceConfigs: DynatraceConfig[];
  loadingConfigs: boolean;
  selectedDynatraceConfigId: string;
  setSelectedDynatraceConfigId: (id: string) => void;

  // File state
  file: File | null;
  isAnalyzing: boolean;

  // Parsed data state
  parsedTiles: DashboardTile[];
  allVariables: string[];
  variableValues: Record<string, string>;

  // Form state
  dashboardName: string;
  setDashboardName: (name: string) => void;
  metricUnit: string;
  setMetricUnit: (unit: string) => void;
  error: string | null;

  // Handlers
  handleFileSelect: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleVariableChange: (variable: string, value: string) => void;
  handleTileSelection: (tileId: string, selected: boolean) => void;
  handleSelectAll: (selected: boolean) => void;
  handleImport: () => void;
  handleClose: () => void;
}

export function useImportDashboard({
  open,
  onImport,
}: UseImportDashboardProps): UseImportDashboardReturn {
  const [dynatraceConfigs, setDynatraceConfigs] = useState<DynatraceConfig[]>([]);
  const [loadingConfigs, setLoadingConfigs] = useState(false);
  const [selectedDynatraceConfigId, setSelectedDynatraceConfigId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [parsedTiles, setParsedTiles] = useState<DashboardTile[]>([]);
  const [allVariables, setAllVariables] = useState<string[]>([]);
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [dashboardName, setDashboardName] = useState('Dynatrace');
  const [metricUnit, setMetricUnit] = useState('ms');
  const [error, setError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Fetch Dynatrace configs when dialog opens
  useEffect(() => {
    if (open) {
      const loadConfigs = async () => {
        try {
          setLoadingConfigs(true);
          const configs = await fetchDynatraceConfigs();
          setDynatraceConfigs(configs);
        } catch (err) {
          console.error('Error fetching Dynatrace configs:', err);
          setError('Failed to load Dynatrace instances');
        } finally {
          setLoadingConfigs(false);
        }
      };
      loadConfigs();
    }
  }, [open]);

  const handleAnalyze = useCallback(async (fileToAnalyze: File) => {
    setIsAnalyzing(true);
    setError(null);

    try {
      const fileContent = await fileToAnalyze.text();
      const result = parseDashboardFile(fileContent);

      if (result.error) {
        setError(result.error);
        setParsedTiles([]);
        setAllVariables([]);
        setVariableValues({});
      } else {
        setParsedTiles(result.tiles);
        setAllVariables(result.variables);
        setVariableValues(initializeVariableValues(result.variables));
      }
    } catch (err) {
      console.error('Error analyzing dashboard:', err);
      const errorMessage =
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to analyze dashboard file';
      setError(errorMessage);
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  const handleFileSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setError(null);
      setParsedTiles([]);
      setAllVariables([]);
      setVariableValues({});

      // Automatically analyze the file
      await handleAnalyze(selectedFile);
    }
  }, [handleAnalyze]);

  const handleVariableChange = useCallback((variable: string, value: string) => {
    setVariableValues(prev => ({
      ...prev,
      [variable]: value,
    }));
  }, []);

  const handleTileSelection = useCallback((tileId: string, selected: boolean) => {
    setParsedTiles(prev =>
      prev.map(tile => (tile.id === tileId ? { ...tile, selected } : tile))
    );
  }, []);

  const handleSelectAll = useCallback((selected: boolean) => {
    setParsedTiles(prev => prev.map(tile => ({ ...tile, selected })));
  }, []);

  const handleImport = useCallback(() => {
    if (!selectedDynatraceConfigId) {
      setError('Please select a Dynatrace instance');
      return;
    }

    const selectedTiles = parsedTiles.filter(tile => tile.selected);

    if (selectedTiles.length === 0) {
      setError('Please select at least one tile to import');
      return;
    }

    if (!dashboardName.trim()) {
      setError('Please provide a dashboard name');
      return;
    }

    // Check if all variables have values
    const missingVariables = allVariables.filter(
      variable => !variableValues[variable]?.trim()
    );
    if (missingVariables.length > 0) {
      setError(`Please provide values for variables: ${missingVariables.join(', ')}`);
      return;
    }

    onImport(selectedTiles, variableValues, dashboardName, metricUnit, selectedDynatraceConfigId);
  }, [
    selectedDynatraceConfigId,
    parsedTiles,
    dashboardName,
    allVariables,
    variableValues,
    metricUnit,
    onImport,
  ]);

  const handleClose = useCallback(() => {
    setFile(null);
    setParsedTiles([]);
    setAllVariables([]);
    setVariableValues({});
    setDashboardName('Dynatrace');
    setMetricUnit('ms');
    setSelectedDynatraceConfigId('');
    setDynatraceConfigs([]);
    setError(null);
    setIsAnalyzing(false);
  }, []);

  return {
    // Dynatrace configs state
    dynatraceConfigs,
    loadingConfigs,
    selectedDynatraceConfigId,
    setSelectedDynatraceConfigId,

    // File state
    file,
    isAnalyzing,

    // Parsed data state
    parsedTiles,
    allVariables,
    variableValues,

    // Form state
    dashboardName,
    setDashboardName,
    metricUnit,
    setMetricUnit,
    error,

    // Handlers
    handleFileSelect,
    handleVariableChange,
    handleTileSelection,
    handleSelectAll,
    handleImport,
    handleClose,
  };
}
