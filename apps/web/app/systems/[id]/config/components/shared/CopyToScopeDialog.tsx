'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  RadioGroup,
  Radio,
  FormControlLabel,
  FormControl,
  FormLabel,
  Autocomplete,
  TextField,
  Typography,
  Box,
  Alert,
  CircularProgress,
  Switch,
} from '@mui/material';
import { ContentCopy as CopyIcon } from '@mui/icons-material';
import {
  fetchAllSystemsUnderTest,
  fetchSystemSummary,
  type SystemSummary,
} from '@/lib/systems';
import { SystemUnderTest } from '@/types/test-runs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CopyTarget {
  systemUnderTestId: string;
  testEnvironment: string;
  workload?: string;
  conflictStrategy: 'skip' | 'overwrite';
}

export interface CopyToScopeDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called when the user confirms the copy action. Should throw on failure. */
  onCopy: (target: CopyTarget) => Promise<void>;
  currentScope: {
    systemId: string;
    systemName: string;
    environment: string;
    /** Undefined for item types that are environment-scoped (e.g. dashboards). */
    workload?: string;
  };
  /** Total number of items in the current scope. */
  itemCount: number;
  /** When a subset is explicitly selected, provide the selected count. */
  selectedCount?: number;
  /** Human-readable label for the item type, e.g. "SLOs", "deep links". */
  itemType: string;
  /** Set to false for item types that are environment-scoped (e.g. dashboards). */
  supportsWorkload: boolean;
}

type ScopeLevel = 'workload' | 'environment' | 'system';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the workloads available for the given environment within a summary. */
function getWorkloadsForEnv(summary: SystemSummary | null, env: string): string[] {
  if (!summary) return [];
  const match = summary.environments.find((e) => e.environment === env);
  return match ? match.workloads : [];
}

/** Returns all unique environment names from a system summary. */
function getEnvironments(summary: SystemSummary | null): string[] {
  if (!summary) return [];
  return summary.environments.map((e) => e.environment);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * A dialog that lets users copy configuration items (SLOs, deep links,
 * dashboards, report templates) to another scope (workload, environment, or
 * system). The caller is responsible for the actual copy operation via the
 * `onCopy` callback.
 */
export function CopyToScopeDialog({
  open,
  onClose,
  onCopy,
  currentScope,
  itemCount,
  selectedCount,
  itemType,
  supportsWorkload,
}: CopyToScopeDialogProps) {
  // Scope level selection
  const defaultScopeLevel: ScopeLevel = supportsWorkload ? 'workload' : 'environment';
  const [scopeLevel, setScopeLevel] = useState<ScopeLevel>(defaultScopeLevel);

  // Current system summary (environments + workloads)
  const [currentSummary, setCurrentSummary] = useState<SystemSummary | null>(null);
  const [loadingCurrentSummary, setLoadingCurrentSummary] = useState(false);

  // All systems list (loaded when "Another system" is selected)
  const [allSystems, setAllSystems] = useState<SystemUnderTest[]>([]);
  const [loadingAllSystems, setLoadingAllSystems] = useState(false);

  // Target system summary (loaded when user picks a different system)
  const [targetSummary, setTargetSummary] = useState<SystemSummary | null>(null);
  const [loadingTargetSummary, setLoadingTargetSummary] = useState(false);

  // User selections for the target scope
  const [targetSystem, setTargetSystem] = useState<SystemUnderTest | null>(null);
  const [targetEnvironment, setTargetEnvironment] = useState<string | null>(null);
  const [targetWorkload, setTargetWorkload] = useState<string | null>(null);

  // Conflict strategy
  const [overwrite, setOverwrite] = useState(false);

  // Copy operation state
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (!open) return;
    setScopeLevel(defaultScopeLevel);
    setTargetSystem(null);
    setTargetEnvironment(null);
    setTargetWorkload(null);
    setOverwrite(false);
    setError(null);
    setTargetSummary(null);
  }, [open, defaultScopeLevel]);

  // Load current system summary when dialog opens
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function load() {
      setLoadingCurrentSummary(true);
      try {
        const summary = await fetchSystemSummary(currentScope.systemId);
        if (!cancelled) setCurrentSummary(summary);
      } catch (err) {
        // Non-critical: the dialog can still function for system-level selection
        console.error('Failed to load current system summary', err);
      } finally {
        if (!cancelled) setLoadingCurrentSummary(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [open, currentScope.systemId]);

  // Load all systems when "Another system" scope is selected
  useEffect(() => {
    if (scopeLevel !== 'system') return;
    if (allSystems.length > 0) return; // already loaded
    let cancelled = false;

    async function load() {
      setLoadingAllSystems(true);
      try {
        const systems = await fetchAllSystemsUnderTest();
        if (!cancelled) setAllSystems(systems);
      } catch (err) {
        const message =
          err && typeof err === 'object' && 'message' in err
            ? (err as Error).message
            : 'Failed to load systems';
        if (!cancelled) setError(message);
      } finally {
        if (!cancelled) setLoadingAllSystems(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [scopeLevel, allSystems.length]);

  // Load target system summary when user picks a different system
  useEffect(() => {
    if (!targetSystem?.id) {
      setTargetSummary(null);
      return;
    }
    let cancelled = false;

    async function load() {
      setLoadingTargetSummary(true);
      try {
        const summary = await fetchSystemSummary(targetSystem!.id as string);
        if (!cancelled) setTargetSummary(summary);
      } catch (err) {
        const message =
          err && typeof err === 'object' && 'message' in err
            ? (err as Error).message
            : 'Failed to load target system details';
        if (!cancelled) setError(message);
      } finally {
        if (!cancelled) setLoadingTargetSummary(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [targetSystem]);

  // Clear dependent selections when scope level changes
  const handleScopeLevelChange = useCallback((value: ScopeLevel) => {
    setScopeLevel(value);
    setTargetSystem(null);
    setTargetEnvironment(null);
    setTargetWorkload(null);
    setTargetSummary(null);
    setError(null);
  }, []);

  // Clear workload when environment changes
  const handleEnvironmentChange = useCallback((_: unknown, value: string | null) => {
    setTargetEnvironment(value);
    setTargetWorkload(null);
  }, []);

  // Clear environment + workload when system changes
  const handleSystemChange = useCallback((_: unknown, value: SystemUnderTest | null) => {
    setTargetSystem(value);
    setTargetEnvironment(null);
    setTargetWorkload(null);
    setTargetSummary(null);
  }, []);

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  const activeSummary = scopeLevel === 'system' ? targetSummary : currentSummary;

  const availableEnvironments: string[] = (() => {
    const envs = getEnvironments(activeSummary);
    if (scopeLevel === 'environment') {
      // Filter out the current environment (same system, different env)
      return envs.filter((e) => e !== currentScope.environment);
    }
    return envs;
  })();

  const availableWorkloads: string[] = (() => {
    // For "Another workload" scope, use current environment implicitly
    const env = scopeLevel === 'workload' ? currentScope.environment : targetEnvironment;
    if (!env) return [];
    const all = getWorkloadsForEnv(activeSummary, env);
    if (scopeLevel === 'workload') {
      // Same system + same env: filter out current workload
      return all.filter((w) => w !== currentScope.workload);
    }
    return all;
  })();

  const systemOptions: SystemUnderTest[] = allSystems.filter(
    (s) => s.id !== currentScope.systemId
  );

  const copyCount = selectedCount !== undefined ? selectedCount : itemCount;
  const copyLabel =
    selectedCount !== undefined
      ? `Copy ${copyCount} selected ${itemType}`
      : `Copy all ${copyCount} ${itemType}`;

  // Determine whether all required fields are filled
  const isReady = (() => {
    if (scopeLevel === 'workload') {
      return supportsWorkload ? !!targetWorkload : false;
    }
    if (scopeLevel === 'environment') {
      return supportsWorkload ? !!targetEnvironment && !!targetWorkload : !!targetEnvironment;
    }
    if (scopeLevel === 'system') {
      if (!targetSystem) return false;
      if (!targetEnvironment) return false;
      if (supportsWorkload && !targetWorkload) return false;
      return true;
    }
    return false;
  })();

  // Build a human-readable target scope string
  const targetScopeLabel = (() => {
    const systemName =
      scopeLevel === 'system' ? targetSystem?.name ?? '' : currentScope.systemName;
    const parts: string[] = [systemName];
    if (targetEnvironment) parts.push(targetEnvironment);
    if (targetWorkload) parts.push(targetWorkload);
    return parts.filter(Boolean).join(' / ');
  })();

  // ---------------------------------------------------------------------------
  // Copy handler
  // ---------------------------------------------------------------------------

  const handleCopy = useCallback(async () => {
    if (!isReady) return;

    const target: CopyTarget = {
      systemUnderTestId:
        scopeLevel === 'system' && targetSystem?.id
          ? (targetSystem.id as string)
          : currentScope.systemId,
      testEnvironment:
        scopeLevel === 'workload' ? currentScope.environment : (targetEnvironment as string),
      workload: supportsWorkload ? (targetWorkload ?? undefined) : undefined,
      conflictStrategy: overwrite ? 'overwrite' : 'skip',
    };

    setCopying(true);
    setError(null);
    try {
      await onCopy(target);
      onClose();
    } catch (err) {
      const message =
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to copy items';
      setError(message);
    } finally {
      setCopying(false);
    }
  }, [
    isReady,
    scopeLevel,
    targetSystem,
    targetEnvironment,
    targetWorkload,
    overwrite,
    supportsWorkload,
    currentScope,
    onCopy,
    onClose,
  ]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <CopyIcon fontSize="small" />
        Copy {itemType}
      </DialogTitle>

      <DialogContent dividers>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {/* Source info */}
          <Box>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Source
            </Typography>
            <Typography variant="body2" fontWeight={500}>
              {currentScope.systemName}
              {currentScope.environment && ` / ${currentScope.environment}`}
              {currentScope.workload && ` / ${currentScope.workload}`}
            </Typography>
          </Box>

          {/* Copy count */}
          <Typography variant="body2">
            <strong>{copyLabel}</strong>
          </Typography>

          {/* Scope level selection */}
          <FormControl component="fieldset">
            <FormLabel component="legend" sx={{ mb: 1 }}>
              Copy to
            </FormLabel>
            <RadioGroup
              value={scopeLevel}
              onChange={(e) => handleScopeLevelChange(e.target.value as ScopeLevel)}
            >
              {supportsWorkload && (
                <FormControlLabel
                  value="workload"
                  control={<Radio size="small" />}
                  label="Another workload"
                />
              )}
              <FormControlLabel
                value="environment"
                control={<Radio size="small" />}
                label="Another environment"
              />
              <FormControlLabel
                value="system"
                control={<Radio size="small" />}
                label="Another system"
              />
            </RadioGroup>
          </FormControl>

          {/* Conditional selectors */}
          {scopeLevel === 'workload' && supportsWorkload && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {loadingCurrentSummary ? (
                <CircularProgress size={20} />
              ) : (
                <Autocomplete
                  options={availableWorkloads}
                  value={targetWorkload}
                  onChange={(_, value) => setTargetWorkload(value)}
                  renderInput={(params) => (
                    <TextField {...params} label="Workload" size="small" required />
                  )}
                  noOptionsText={
                    currentScope.environment
                      ? 'No other workloads available'
                      : 'Select an environment first'
                  }
                />
              )}
            </Box>
          )}

          {scopeLevel === 'environment' && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {loadingCurrentSummary ? (
                <CircularProgress size={20} />
              ) : (
                <>
                  <Autocomplete
                    options={availableEnvironments}
                    value={targetEnvironment}
                    onChange={handleEnvironmentChange}
                    renderInput={(params) => (
                      <TextField {...params} label="Environment" size="small" required />
                    )}
                    noOptionsText="No other environments available"
                  />
                  {supportsWorkload && (
                    <Autocomplete
                      options={availableWorkloads}
                      value={targetWorkload}
                      onChange={(_, value) => setTargetWorkload(value)}
                      disabled={!targetEnvironment}
                      renderInput={(params) => (
                        <TextField {...params} label="Workload" size="small" required />
                      )}
                      noOptionsText={
                        targetEnvironment
                          ? 'No workloads available for this environment'
                          : 'Select an environment first'
                      }
                    />
                  )}
                </>
              )}
            </Box>
          )}

          {scopeLevel === 'system' && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {loadingAllSystems ? (
                <CircularProgress size={20} />
              ) : (
                <Autocomplete
                  options={systemOptions}
                  getOptionLabel={(s) => s.name}
                  value={targetSystem}
                  onChange={handleSystemChange}
                  renderInput={(params) => (
                    <TextField {...params} label="System" size="small" required />
                  )}
                  noOptionsText="No other systems available"
                />
              )}

              {targetSystem && (
                <>
                  {loadingTargetSummary ? (
                    <CircularProgress size={20} />
                  ) : (
                    <>
                      <Autocomplete
                        options={availableEnvironments}
                        value={targetEnvironment}
                        onChange={handleEnvironmentChange}
                        renderInput={(params) => (
                          <TextField {...params} label="Environment" size="small" required />
                        )}
                        noOptionsText="No environments available for this system"
                      />
                      {supportsWorkload && (
                        <Autocomplete
                          options={availableWorkloads}
                          value={targetWorkload}
                          onChange={(_, value) => setTargetWorkload(value)}
                          disabled={!targetEnvironment}
                          renderInput={(params) => (
                            <TextField {...params} label="Workload" size="small" required />
                          )}
                          noOptionsText={
                            targetEnvironment
                              ? 'No workloads available for this environment'
                              : 'Select an environment first'
                          }
                        />
                      )}
                    </>
                  )}
                </>
              )}
            </Box>
          )}

          {/* Target scope preview */}
          {isReady && (
            <Box sx={{ bgcolor: 'action.hover', borderRadius: 1, px: 2, py: 1 }}>
              <Typography variant="body2" color="text.secondary">
                Target: <strong>{targetScopeLabel}</strong>
              </Typography>
            </Box>
          )}

          {/* Conflict strategy */}
          <FormControlLabel
            control={
              <Switch
                checked={overwrite}
                onChange={(e) => setOverwrite(e.target.checked)}
                size="small"
              />
            }
            label={
              <Typography variant="body2">
                Overwrite existing items
              </Typography>
            }
          />

          {/* Error feedback */}
          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={copying}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleCopy}
          disabled={!isReady || copying}
          startIcon={copying ? <CircularProgress size={16} color="inherit" /> : <CopyIcon />}
        >
          {copying ? 'Copying...' : 'Copy'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default CopyToScopeDialog;
