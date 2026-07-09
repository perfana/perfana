'use client';

/**
 * Section Configuration Forms
 *
 * Provides configuration UI for each report section type
 */

import { useState, useEffect } from 'react';
import { Autocomplete, Box, TextField, Select, MenuItem, FormControlLabel, Switch, Typography, Button, Tooltip, FormControl, InputLabel, Checkbox, IconButton } from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import DeleteIcon from '@mui/icons-material/Delete';
import SectionPreviewModal from './SectionPreviewModal';
import dynamic from 'next/dynamic';
import { authenticatedFetch } from '@/lib/api';
import { fetchDynatraceDashboards, fetchDynatraceMetrics } from '@/lib/dynatrace';
import { isGrafana } from '@/lib/metrics-source-utils';

// Dynamically import preview components to reduce initial bundle size
const ApdexSectionPreview = dynamic(() => import('./preview/ApdexSectionPreview'), { ssr: false });

// ==================== Header Section Config ====================

/** @public */
export interface HeaderConfig {
  text?: string;
  level?: number;
}

interface HeaderConfigFormProps {
  config: HeaderConfig;
  onChange: (config: HeaderConfig) => void;
}

export function HeaderConfigForm({ config, onChange }: HeaderConfigFormProps) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <TextField
        label="Header Text"
        value={config.text || ''}
        onChange={(e) => onChange({ ...config, text: e.target.value })}
        fullWidth
        size="small"
      />
      <Box>
        <Typography variant="caption" color="text.secondary" gutterBottom>
          Header Level (H1-H6)
        </Typography>
        <Select
          value={config.level || 1}
          onChange={(e) => onChange({ ...config, level: Number(e.target.value) })}
          fullWidth
          size="small"
        >
          <MenuItem value={1}>H1 - Largest</MenuItem>
          <MenuItem value={2}>H2</MenuItem>
          <MenuItem value={3}>H3</MenuItem>
          <MenuItem value={4}>H4</MenuItem>
          <MenuItem value={5}>H5</MenuItem>
          <MenuItem value={6}>H6 - Smallest</MenuItem>
        </Select>
      </Box>
    </Box>
  );
}

// ==================== Text Block Section Config ====================

/** @public */
export interface TextBlockConfig {
  content?: string;
  fontSize?: number;
  markdown?: boolean;
  alignment?: 'left' | 'center' | 'right' | 'justify';
}

interface TextBlockConfigFormProps {
  config: TextBlockConfig;
  onChange: (config: TextBlockConfig) => void;
}

export function TextBlockConfigForm({ config, onChange }: TextBlockConfigFormProps) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <TextField
        label="Content"
        value={config.content || ''}
        onChange={(e) => onChange({ ...config, content: e.target.value })}
        multiline
        rows={4}
        fullWidth
        size="small"
        placeholder="Enter text content (markdown supported)"
      />
      <Box sx={{ display: 'flex', gap: 2 }}>
        <TextField
          label="Font Size"
          type="number"
          value={config.fontSize || 11}
          onChange={(e) => onChange({ ...config, fontSize: Number(e.target.value) })}
          size="small"
          sx={{ width: 120 }}
          inputProps={{ min: 8, max: 24 }}
        />
        <Select
          value={config.alignment || 'left'}
          onChange={(e) => onChange({ ...config, alignment: e.target.value as TextBlockConfig['alignment'] })}
          size="small"
          sx={{ flex: 1 }}
        >
          <MenuItem value="left">Left</MenuItem>
          <MenuItem value="center">Center</MenuItem>
          <MenuItem value="right">Right</MenuItem>
          <MenuItem value="justify">Justify</MenuItem>
        </Select>
      </Box>
      <FormControlLabel
        control={
          <Switch
            checked={config.markdown ?? true}
            onChange={(e) => onChange({ ...config, markdown: e.target.checked })}
          />
        }
        label="Enable Markdown"
      />
    </Box>
  );
}

// ==================== SLO Section Config ====================

/** @public */
export interface SloConfig {
  maxItems?: number;
  showDetails?: boolean;
  statusFilter?: string[];
  includeTrends?: boolean;
  showSummaryTable?: boolean;
}

interface SloConfigFormProps {
  config: SloConfig;
  onChange: (config: SloConfig) => void;
}

export function SloConfigForm({ config, onChange }: SloConfigFormProps) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <TextField
        label="Max Items"
        type="number"
        value={config.maxItems || 50}
        onChange={(e) => onChange({ ...config, maxItems: Number(e.target.value) })}
        size="small"
        inputProps={{ min: 1, max: 100 }}
      />
      <FormControlLabel
        control={
          <Switch
            checked={config.showDetails ?? true}
            onChange={(e) => onChange({ ...config, showDetails: e.target.checked })}
          />
        }
        label="Show Details"
      />
      <FormControlLabel
        control={
          <Switch
            checked={config.showSummaryTable ?? true}
            onChange={(e) => onChange({ ...config, showSummaryTable: e.target.checked })}
          />
        }
        label="Show Summary Table"
      />
      <FormControlLabel
        control={
          <Switch
            checked={config.includeTrends ?? false}
            onChange={(e) => onChange({ ...config, includeTrends: e.target.checked })}
          />
        }
        label="Include Trends"
      />
    </Box>
  );
}

// ==================== Apdex Section Config ====================

export interface ApdexConfig {
  showSummary?: boolean;
  errorThreshold?: number;
  warningThreshold?: number;
  showTransactionLevel?: boolean;
  includeDistributionChart?: boolean;
  excludeRampUp?: boolean;
  comment?: string; // Added for section comments
}

interface ApdexConfigFormProps {
  config: ApdexConfig;
  onChange: (config: ApdexConfig) => void;
  testRunId?: string; // Optional test run ID for preview
}

export function ApdexConfigForm({ config, onChange, testRunId }: ApdexConfigFormProps) {
  const [previewOpen, setPreviewOpen] = useState(false);

  const handleCommentChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...config, comment: event.target.value });
  };

  return (
    <>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {/* Apply to analysis timerange only Toggle */}
        <Tooltip title="Apply statistics to the configured analysis timerange only" arrow>
          <FormControlLabel
            control={
              <Switch
                checked={config.excludeRampUp ?? true}
                onChange={(e) => onChange({ ...config, excludeRampUp: e.target.checked })}
                size="small"
                sx={{
                  '& .MuiSwitch-switchBase.Mui-checked': {
                    color: 'primary.main',
                  },
                  '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                    backgroundColor: 'primary.main',
                  },
                }}
              />
            }
            label="Apply to analysis timerange only"
            sx={{
              '& .MuiFormControlLabel-label': {
                fontSize: '0.875rem',
                fontWeight: 500,
              },
            }}
          />
        </Tooltip>

        {/* Comment Text Area */}
        <TextField
          fullWidth
          multiline
          rows={4}
          value={config.comment || ''}
          onChange={handleCommentChange}
          placeholder="Add comments or observations about this section..."
          label="Section Comments"
          variant="outlined"
          helperText={`${(config.comment || '').length} / 2000 characters`}
          inputProps={{
            maxLength: 2000,
          }}
          sx={{
            '& .MuiOutlinedInput-root': {
              '&:hover fieldset': {
                borderColor: '#1976d2',
              },
            },
          }}
        />

        {/* Preview Button */}
        <Button
          variant="outlined"
          startIcon={<VisibilityIcon />}
          onClick={() => setPreviewOpen(true)}
          fullWidth
          sx={{
            textTransform: 'none',
            fontWeight: 600,
            borderColor: '#1976d2',
            color: '#1976d2',
            py: 1.5,
            '&:hover': {
              borderColor: '#1565c0',
              bgcolor: 'rgba(25, 118, 210, 0.04)',
            },
          }}
        >
          Preview Section
        </Button>
      </Box>

      {/* Preview Modal */}
      <SectionPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        sectionTitle="Apdex Score"
        sectionType="Apdex"
        testRunId={testRunId}
        initialComment={config.comment}
        onSaveComment={(comment) => onChange({ ...config, comment })}
      >
        <ApdexSectionPreview testRunId={testRunId} config={config} />
      </SectionPreviewModal>
    </>
  );
}

// ==================== Transaction Response Times Config ====================

/** @public */
export interface TransactionResponseTimesConfig {
  scenario?: string;
  comment?: string;
}

interface TransactionResponseTimesConfigFormProps {
  config: TransactionResponseTimesConfig;
  onChange: (config: TransactionResponseTimesConfig) => void;
  testRunId?: string; // Optional test run ID for fetching scenarios and preview
}

export function TransactionResponseTimesConfigForm({ config, onChange, testRunId }: TransactionResponseTimesConfigFormProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [scenarios, setScenarios] = useState<string[]>([]);
  const [loadingScenarios, setLoadingScenarios] = useState(false);

  // Fetch scenarios from transactions table
  useEffect(() => {
    if (!testRunId) {
      return;
    }

    const fetchScenarios = async () => {
      setLoadingScenarios(true);
      try {
        const response = await authenticatedFetch(
          `/test-runs/${testRunId}/transactions`,
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          console.error('Response error:', errorText);
          throw new Error(`Failed to fetch transactions: ${response.status} ${response.statusText}`);
        }

        const transactions = await response.json();

        if (!Array.isArray(transactions)) {
          console.error('Transactions is not an array:', typeof transactions, transactions);
          setScenarios([]);
          return;
        }

        if (transactions.length === 0) {
          console.warn('No transactions found for test run:', testRunId);
          setScenarios([]);
          return;
        }

        // Extract unique scenario names (not transaction names)
        const uniqueScenarios = Array.from(new Set(transactions.map((t: { scenario_name?: string }) => t.scenario_name).filter(Boolean)));
        setScenarios(uniqueScenarios as string[]);
      } catch (err) {
        console.error('Failed to fetch scenarios:', err);
        setScenarios([]);
      } finally {
        setLoadingScenarios(false);
      }
    };

    fetchScenarios();
  }, [testRunId]);

  const handleCommentChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...config, comment: event.target.value });
  };

  return (
    <>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {/* Scenario Input - Dropdown if scenarios available, otherwise text field */}
        {scenarios.length > 0 ? (
          <Select
            value={config.scenario || ''}
            onChange={(e) => onChange({ ...config, scenario: e.target.value })}
            fullWidth
            size="small"
            displayEmpty
            disabled={loadingScenarios}
          >
            <MenuItem value="" disabled>
              Select a scenario ({scenarios.length} available)
            </MenuItem>
            {scenarios.map((scenario) => (
              <MenuItem key={scenario} value={scenario}>
                {scenario}
              </MenuItem>
            ))}
          </Select>
        ) : (
          <TextField
            label="Scenario / Transaction Name"
            value={config.scenario || ''}
            onChange={(e) => onChange({ ...config, scenario: e.target.value })}
            fullWidth
            size="small"
            placeholder="e.g., BrowseAndSearch, LoginFlow"
            disabled={loadingScenarios}
            helperText={
              loadingScenarios
                ? 'Loading scenarios...'
                : !testRunId
                  ? 'No test run selected - enter scenario name manually'
                  : 'No scenarios found for this test run - enter manually or select a different test run'
            }
          />
        )}

        {/* Debug info */}
        {process.env.NODE_ENV === 'development' && (
          <Typography variant="caption" color="text.secondary">
            Debug: testRunId={testRunId || 'undefined'}, scenarios={scenarios.length}, loading={loadingScenarios.toString()}
          </Typography>
        )}

        {/* Comment Text Area */}
        <TextField
          fullWidth
          multiline
          rows={4}
          value={config.comment || ''}
          onChange={handleCommentChange}
          placeholder="Add comments or observations about this section..."
          label="Section Comments"
          variant="outlined"
          helperText={`${(config.comment || '').length} / 2000 characters`}
          inputProps={{
            maxLength: 2000,
          }}
          sx={{
            '& .MuiOutlinedInput-root': {
              '&:hover fieldset': {
                borderColor: '#1976d2',
              },
            },
          }}
        />

        {/* Preview Button */}
        <Button
          variant="outlined"
          startIcon={<VisibilityIcon />}
          onClick={() => setPreviewOpen(true)}
          fullWidth
          disabled={!config.scenario}
          sx={{
            textTransform: 'none',
            fontWeight: 600,
            borderColor: '#1976d2',
            color: '#1976d2',
            py: 1.5,
            '&:hover': {
              borderColor: '#1565c0',
              bgcolor: 'rgba(25, 118, 210, 0.04)',
            },
            '&.Mui-disabled': {
              borderColor: 'rgba(0, 0, 0, 0.12)',
              color: 'rgba(0, 0, 0, 0.26)',
            },
          }}
        >
          Preview Section
        </Button>
      </Box>

      {/* Preview Modal */}
      <SectionPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        sectionTitle={`Response Times - ${config.scenario || 'N/A'}`}
        sectionType="Transaction Response Times"
        testRunId={testRunId}
        initialComment={config.comment}
        onSaveComment={(comment) => onChange({ ...config, comment })}
      >
        <Box sx={{ p: 2, textAlign: 'center' }}>
          {/* Placeholder - actual preview component would be created separately */}
          <Typography variant="body2" color="text.secondary">
            Response times preview for <strong>{config.scenario}</strong> would appear here.
          </Typography>
        </Box>
      </SectionPreviewModal>
    </>
  );
}

// ==================== Regressions Config ====================

/** @public */
export interface RegressionsConfig {
  sortBy?: 'severity' | 'change' | 'name';
  maxItems?: number;
  regressionsOnly?: boolean;
  minChangePercent?: number;
  showComparisonDetails?: boolean;
  includeComparisonChart?: boolean;
}

interface RegressionsConfigFormProps {
  config: RegressionsConfig;
  onChange: (config: RegressionsConfig) => void;
}

export function RegressionsConfigForm({ config, onChange }: RegressionsConfigFormProps) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Select
        value={config.sortBy || 'severity'}
        onChange={(e) => onChange({ ...config, sortBy: e.target.value as RegressionsConfig['sortBy'] })}
        fullWidth
        size="small"
      >
        <MenuItem value="severity">Sort by Severity</MenuItem>
        <MenuItem value="change">Sort by Change</MenuItem>
        <MenuItem value="name">Sort by Name</MenuItem>
      </Select>
      <TextField
        label="Max Items"
        type="number"
        value={config.maxItems || 20}
        onChange={(e) => onChange({ ...config, maxItems: Number(e.target.value) })}
        size="small"
        inputProps={{ min: 1, max: 100 }}
      />
      <TextField
        label="Min Change Percent"
        type="number"
        value={config.minChangePercent || 5}
        onChange={(e) => onChange({ ...config, minChangePercent: Number(e.target.value) })}
        size="small"
        inputProps={{ min: 0, max: 100 }}
      />
      <FormControlLabel
        control={
          <Switch
            checked={config.regressionsOnly ?? false}
            onChange={(e) => onChange({ ...config, regressionsOnly: e.target.checked })}
          />
        }
        label="Regressions Only"
      />
      <FormControlLabel
        control={
          <Switch
            checked={config.showComparisonDetails ?? true}
            onChange={(e) => onChange({ ...config, showComparisonDetails: e.target.checked })}
          />
        }
        label="Show Comparison Details"
      />
      <FormControlLabel
        control={
          <Switch
            checked={config.includeComparisonChart ?? false}
            onChange={(e) => onChange({ ...config, includeComparisonChart: e.target.checked })}
          />
        }
        label="Include Comparison Chart"
      />
    </Box>
  );
}

// ==================== Graphs Config ====================

/** @public */
export interface GraphsConfig {
  panels?: string[];
  quality?: 'low' | 'standard' | 'high';
  timeRange?: {
    startOffset?: number;
    endOffset?: number;
  };
  showLegends?: boolean;
}

interface GraphsConfigFormProps {
  config: GraphsConfig;
  onChange: (config: GraphsConfig) => void;
}

export function GraphsConfigForm({ config, onChange }: GraphsConfigFormProps) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Select
        value={config.quality || 'standard'}
        onChange={(e) => onChange({ ...config, quality: e.target.value as GraphsConfig['quality'] })}
        fullWidth
        size="small"
      >
        <MenuItem value="low">Low Quality</MenuItem>
        <MenuItem value="standard">Standard Quality</MenuItem>
        <MenuItem value="high">High Quality</MenuItem>
      </Select>
      <FormControlLabel
        control={
          <Switch
            checked={config.showLegends ?? true}
            onChange={(e) => onChange({ ...config, showLegends: e.target.checked })}
          />
        }
        label="Show Legends"
      />
      <Box sx={{ display: 'flex', gap: 2 }}>
        <TextField
          label="Start Offset (min)"
          type="number"
          value={config.timeRange?.startOffset || 0}
          onChange={(e) => onChange({
            ...config,
            timeRange: { ...config.timeRange, startOffset: Number(e.target.value) },
          })}
          size="small"
          sx={{ flex: 1 }}
        />
        <TextField
          label="End Offset (min)"
          type="number"
          value={config.timeRange?.endOffset || 0}
          onChange={(e) => onChange({
            ...config,
            timeRange: { ...config.timeRange, endOffset: Number(e.target.value) },
          })}
          size="small"
          sx={{ flex: 1 }}
        />
      </Box>
    </Box>
  );
}

// ==================== AWR Config ====================

/** @public */
export interface AwrConfig {
  topSqlCount?: number;
  showSqlStats?: boolean;
  showWaitEvents?: boolean;
  showTablespaceUsage?: boolean;
  includeExecutionPlans?: boolean;
}

interface AwrConfigFormProps {
  config: AwrConfig;
  onChange: (config: AwrConfig) => void;
}

export function AwrConfigForm({ config, onChange }: AwrConfigFormProps) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <TextField
        label="Top SQL Count"
        type="number"
        value={config.topSqlCount || 10}
        onChange={(e) => onChange({ ...config, topSqlCount: Number(e.target.value) })}
        size="small"
        inputProps={{ min: 1, max: 50 }}
      />
      <FormControlLabel
        control={
          <Switch
            checked={config.showSqlStats ?? true}
            onChange={(e) => onChange({ ...config, showSqlStats: e.target.checked })}
          />
        }
        label="Show SQL Stats"
      />
      <FormControlLabel
        control={
          <Switch
            checked={config.showWaitEvents ?? true}
            onChange={(e) => onChange({ ...config, showWaitEvents: e.target.checked })}
          />
        }
        label="Show Wait Events"
      />
      <FormControlLabel
        control={
          <Switch
            checked={config.showTablespaceUsage ?? false}
            onChange={(e) => onChange({ ...config, showTablespaceUsage: e.target.checked })}
          />
        }
        label="Show Tablespace Usage"
      />
      <FormControlLabel
        control={
          <Switch
            checked={config.includeExecutionPlans ?? false}
            onChange={(e) => onChange({ ...config, includeExecutionPlans: e.target.checked })}
          />
        }
        label="Include Execution Plans"
      />
    </Box>
  );
}

// ==================== Trends Config ====================

/** @public */
export interface TrendsConfig {
  metrics?: string[];
  presetId?: string;
  timeRange?: {
    runCount?: number;
  };
  showCharts?: boolean;
  sensitivity?: 'low' | 'medium' | 'high';
  showStatistics?: boolean;
}

interface TrendsConfigFormProps {
  config: TrendsConfig;
  onChange: (config: TrendsConfig) => void;
}

export function TrendsConfigForm({ config, onChange }: TrendsConfigFormProps) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <TextField
        label="Number of Runs"
        type="number"
        value={config.timeRange?.runCount || 10}
        onChange={(e) => onChange({
          ...config,
          timeRange: { ...config.timeRange, runCount: Number(e.target.value) },
        })}
        size="small"
        inputProps={{ min: 2, max: 100 }}
      />
      <Select
        value={config.sensitivity || 'medium'}
        onChange={(e) => onChange({ ...config, sensitivity: e.target.value as TrendsConfig['sensitivity'] })}
        fullWidth
        size="small"
      >
        <MenuItem value="low">Low Sensitivity</MenuItem>
        <MenuItem value="medium">Medium Sensitivity</MenuItem>
        <MenuItem value="high">High Sensitivity</MenuItem>
      </Select>
      <TextField
        label="Preset ID (optional)"
        value={config.presetId || ''}
        onChange={(e) => onChange({ ...config, presetId: e.target.value })}
        fullWidth
        size="small"
      />
      <FormControlLabel
        control={
          <Switch
            checked={config.showCharts ?? true}
            onChange={(e) => onChange({ ...config, showCharts: e.target.checked })}
          />
        }
        label="Show Charts"
      />
      <FormControlLabel
        control={
          <Switch
            checked={config.showStatistics ?? true}
            onChange={(e) => onChange({ ...config, showStatistics: e.target.checked })}
          />
        }
        label="Show Statistics"
      />
    </Box>
  );
}

// ==================== Comparisons Config ====================

/** @public */
export interface ComparisonsConfig {
  showSideBySide?: boolean;
  metricsToCompare?: string[];
  baselineTestRunId?: string;
  autoSelectBaseline?: boolean;
  showDeltaPercentage?: boolean;
  highlightSignificant?: boolean;
  significantChangeThreshold?: number;
  // Baseline-run comparison mode fields
  comparisonMode?: 'control_group' | 'baseline_run';
  source?: 'performance-metrics' | 'grafana' | 'dynatrace';
  metrics?: ('avg' | 'p95' | 'p99')[];
  thresholds?: { good: number; warning: number };
  hostMap?: { current: string; baseline: string }[];
  // grafana/dynatrace only: scope the comparison to one dashboard and selected panels
  dashboardLabel?: string;
  panels?: { id: number; title: string }[];
}

// Panel types the comparison can meaningfully diff (mirrors the compare card).
const COMPARABLE_PANEL_TYPES = ['graph', 'timeseries', 'stat', 'singlestat', 'flamegraph'];

interface BaselineCandidate {
  test_run_id: string;
  test_environment: string;
  workload: string;
  start_time?: string;
  created_at: string;
  application_release?: string;
  annotations?: string[];
}

// Mirrors the compare card's test-run option rendering (CompareSelectionPanel /
// compare-utils), extended with env/workload since baseline candidates span
// all environments and workloads of the SUT.
const formatCandidateTime = (c: BaselineCandidate): string =>
  new Date(c.start_time || c.created_at).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const getCandidateDisplayText = (c: BaselineCandidate): string =>
  `${c.test_run_id} - ${formatCandidateTime(c)}`;

const getCandidateSecondaryInfo = (c: BaselineCandidate): string => {
  const parts = [`${c.test_environment} / ${c.workload}`];
  if (c.application_release) parts.push(`Version: ${c.application_release}`);
  if (c.annotations && c.annotations.length > 0) parts.push(`Annotations: ${c.annotations.join(', ')}`);
  return parts.join(' • ');
};

interface ComparisonsConfigFormProps {
  config: ComparisonsConfig;
  onChange: (config: ComparisonsConfig) => void;
  testRunId?: string;
  systemUnderTestId?: string;
  testEnvironment?: string;
  workload?: string;
}

interface SourceDashboardOption {
  label: string;
  uid?: string; // grafana only — needed to fetch the dashboard's panels
}

export function ComparisonsConfigForm({ config, onChange, testRunId, systemUnderTestId, testEnvironment, workload }: ComparisonsConfigFormProps) {
  const [baselineCandidates, setBaselineCandidates] = useState<BaselineCandidate[]>([]);
  const [sourceDashboards, setSourceDashboards] = useState<SourceDashboardOption[]>([]);
  const [sourcePanels, setSourcePanels] = useState<{ id: number; title: string }[]>([]);

  const comparisonMode = config.comparisonMode ?? 'control_group';
  const source = config.source ?? 'performance-metrics';

  useEffect(() => {
    if (comparisonMode !== 'baseline_run' || !systemUnderTestId) return;
    const params = new URLSearchParams({ systemUnderTestId });
    if (testRunId) params.set('excludeTestRunId', testRunId);
    authenticatedFetch(`/test-runs/baseline-candidates?${params.toString()}`)
      .then((res) => {
        if (!res.ok) { setBaselineCandidates([]); return; }
        return res.json();
      })
      .then((data: BaselineCandidate[] | undefined) => { if (data) setBaselineCandidates(data); })
      .catch(() => setBaselineCandidates([]));
  }, [comparisonMode, systemUnderTestId, testRunId]);

  // Load dashboards for the selected source (grafana/dynatrace) — same endpoints as the compare card
  useEffect(() => {
    if (comparisonMode !== 'baseline_run' || source === 'performance-metrics' || !systemUnderTestId || !testEnvironment) {
      setSourceDashboards([]);
      return;
    }
    if (source === 'grafana') {
      const params = new URLSearchParams({ systemId: systemUnderTestId, environment: testEnvironment });
      authenticatedFetch(`/grafana/application-dashboards?${params.toString()}`)
        .then((res) => (res.ok ? res.json() : undefined))
        .then((data: { dashboard_label?: string; dashboard_uid?: string; source_type?: string }[] | undefined) => {
          if (!Array.isArray(data)) { setSourceDashboards([]); return; }
          setSourceDashboards(
            data.filter((d) => isGrafana(d) && d.dashboard_label)
              .map((d) => ({ label: d.dashboard_label as string, uid: d.dashboard_uid })),
          );
        })
        .catch(() => setSourceDashboards([]));
    } else if (workload) {
      fetchDynatraceDashboards(systemUnderTestId, testEnvironment, workload)
        .then((data) => setSourceDashboards(data.map((d) => ({ label: d.dashboardLabel }))))
        .catch(() => setSourceDashboards([]));
    }
  }, [comparisonMode, source, systemUnderTestId, testEnvironment, workload]);

  // Load panels once a dashboard is selected
  useEffect(() => {
    const dashboardLabel = config.dashboardLabel;
    if (comparisonMode !== 'baseline_run' || source === 'performance-metrics' || !dashboardLabel) {
      setSourcePanels([]);
      return;
    }
    if (source === 'grafana') {
      const uid = sourceDashboards.find((d) => d.label === dashboardLabel)?.uid;
      if (!uid) { setSourcePanels([]); return; }
      authenticatedFetch(`/grafana/dashboards?uid=${encodeURIComponent(uid)}`)
        .then((res) => (res.ok ? res.json() : undefined))
        .then((data: unknown) => {
          const dashboard = Array.isArray(data) ? data[0] : data;
          const panels = (dashboard as { panels?: { id: number; title: string; type: string }[] } | undefined)?.panels ?? [];
          setSourcePanels(
            panels.filter((p) => COMPARABLE_PANEL_TYPES.includes(p.type)).map((p) => ({ id: p.id, title: p.title })),
          );
        })
        .catch(() => setSourcePanels([]));
    } else if (systemUnderTestId && testEnvironment && workload) {
      fetchDynatraceMetrics(systemUnderTestId, testEnvironment, workload, dashboardLabel)
        .then((data) => setSourcePanels(data.map((m) => ({ id: m.panelId, title: m.panelTitle }))))
        .catch(() => setSourcePanels([]));
    }
  }, [comparisonMode, source, config.dashboardLabel, sourceDashboards, systemUnderTestId, testEnvironment, workload]);

  const metrics = config.metrics ?? ['avg', 'p95', 'p99'];

  const toggleMetric = (metric: 'avg' | 'p95' | 'p99') => {
    const next = metrics.includes(metric) ? metrics.filter((m) => m !== metric) : [...metrics, metric];
    onChange({ ...config, metrics: next });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Mode toggle — always visible */}
      <FormControl size="small" fullWidth>
        <InputLabel id="comparison-mode-label">Comparison Mode</InputLabel>
        <Select
          labelId="comparison-mode-label"
          label="Comparison Mode"
          value={comparisonMode}
          onChange={(e) => onChange({ ...config, comparisonMode: e.target.value as 'control_group' | 'baseline_run' })}
        >
          <MenuItem value="control_group">Control Group</MenuItem>
          <MenuItem value="baseline_run">Baseline Run</MenuItem>
        </Select>
      </FormControl>

      {/* Existing control-group fields — hidden in baseline_run mode */}
      {comparisonMode !== 'baseline_run' && (
        <>
          <TextField
            label="Baseline Test Run ID (optional)"
            value={config.baselineTestRunId || ''}
            onChange={(e) => onChange({ ...config, baselineTestRunId: e.target.value })}
            fullWidth
            size="small"
            placeholder="Leave empty for auto-select"
          />
          <TextField
            label="Significant Change Threshold (%)"
            type="number"
            value={config.significantChangeThreshold || 10}
            onChange={(e) => onChange({ ...config, significantChangeThreshold: Number(e.target.value) })}
            size="small"
            inputProps={{ min: 0, max: 100 }}
          />
          <FormControlLabel
            control={
              <Switch
                checked={config.autoSelectBaseline ?? true}
                onChange={(e) => onChange({ ...config, autoSelectBaseline: e.target.checked })}
              />
            }
            label="Auto-Select Baseline"
          />
          <FormControlLabel
            control={
              <Switch
                checked={config.showSideBySide ?? true}
                onChange={(e) => onChange({ ...config, showSideBySide: e.target.checked })}
              />
            }
            label="Show Side-by-Side"
          />
          <FormControlLabel
            control={
              <Switch
                checked={config.showDeltaPercentage ?? true}
                onChange={(e) => onChange({ ...config, showDeltaPercentage: e.target.checked })}
              />
            }
            label="Show Delta Percentage"
          />
          <FormControlLabel
            control={
              <Switch
                checked={config.highlightSignificant ?? true}
                onChange={(e) => onChange({ ...config, highlightSignificant: e.target.checked })}
              />
            }
            label="Highlight Significant Changes"
          />
        </>
      )}

      {/* Baseline-run fields — only shown in baseline_run mode */}
      {comparisonMode === 'baseline_run' && (
        <>
          {/* Baseline run selector — same UX as the compare card's test-run Autocomplete */}
          <Autocomplete
            options={baselineCandidates}
            getOptionLabel={getCandidateDisplayText}
            isOptionEqualToValue={(option, value) => option.test_run_id === value.test_run_id}
            value={baselineCandidates.find((c) => c.test_run_id === config.baselineTestRunId) ?? null}
            onChange={(_, newValue) => onChange({ ...config, baselineTestRunId: newValue?.test_run_id })}
            size="small"
            renderInput={(params) => (
              <TextField
                {...params}
                label="Baseline Test Run"
                variant="outlined"
                fullWidth
                helperText={
                  config.baselineTestRunId
                    ? `Comparing with: ${config.baselineTestRunId}`
                    : `Select from ${baselineCandidates.length} available test runs`
                }
              />
            )}
            renderOption={(props, option) => {
              const { key, ...otherProps } = props;
              return (
                <Box component="li" key={key} {...otherProps}>
                  <Box sx={{ width: '100%' }}>
                    <Typography variant="body1" sx={{ fontWeight: 600 }}>
                      {option.test_run_id}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {formatCandidateTime(option)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {getCandidateSecondaryInfo(option)}
                    </Typography>
                  </Box>
                </Box>
              );
            }}
          />

          {/* Source selector */}
          <FormControl size="small" fullWidth>
            <InputLabel id="source-label">Source</InputLabel>
            <Select
              labelId="source-label"
              label="Source"
              value={config.source ?? 'performance-metrics'}
              onChange={(e) =>
                // Switching source invalidates any dashboard/panel selection from the previous source
                onChange({
                  ...config,
                  source: e.target.value as ComparisonsConfig['source'],
                  dashboardLabel: undefined,
                  panels: undefined,
                })
              }
            >
              <MenuItem value="performance-metrics">Performance Metrics</MenuItem>
              <MenuItem value="grafana">Grafana</MenuItem>
              <MenuItem value="dynatrace">Dynatrace</MenuItem>
            </Select>
          </FormControl>

          {/* Dashboard → panel cascade (grafana/dynatrace only) */}
          {source !== 'performance-metrics' && (
            <>
              <Autocomplete
                options={sourceDashboards}
                getOptionLabel={(o) => o.label}
                isOptionEqualToValue={(o, v) => o.label === v.label}
                value={sourceDashboards.find((d) => d.label === config.dashboardLabel) ?? null}
                onChange={(_, v) => onChange({ ...config, dashboardLabel: v?.label, panels: [] })}
                size="small"
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Dashboard"
                    variant="outlined"
                    fullWidth
                    helperText={
                      config.dashboardLabel
                        ? undefined
                        : `Select a dashboard first (${sourceDashboards.length} available)`
                    }
                  />
                )}
              />
              <Autocomplete
                multiple
                options={sourcePanels}
                getOptionLabel={(o) => o.title}
                isOptionEqualToValue={(o, v) => o.id === v.id}
                value={config.panels ?? []}
                onChange={(_, v) => onChange({ ...config, panels: v })}
                disabled={!config.dashboardLabel}
                size="small"
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Panels"
                    variant="outlined"
                    fullWidth
                    helperText={
                      !config.dashboardLabel
                        ? 'Select a dashboard to see its panels'
                        : `Select one or more panels to compare (${sourcePanels.length} available)`
                    }
                  />
                )}
              />
            </>
          )}

          {/* Metric checkboxes */}
          <Box>
            <Typography variant="caption" color="text.secondary">Metrics</Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              {(['avg', 'p95', 'p99'] as const).map((m) => (
                <FormControlLabel
                  key={m}
                  control={
                    <Checkbox
                      checked={metrics.includes(m)}
                      onChange={() => toggleMetric(m)}
                      size="small"
                    />
                  }
                  label={m}
                />
              ))}
            </Box>
          </Box>

          {/* Threshold number fields */}
          <TextField
            label="Good threshold (%)"
            type="number"
            size="small"
            value={config.thresholds?.good ?? 10}
            onChange={(e) =>
              onChange({
                ...config,
                thresholds: { good: Number(e.target.value), warning: config.thresholds?.warning ?? 50 },
              })
            }
            inputProps={{ min: 0, max: 100 }}
          />
          <TextField
            label="Warning threshold (%)"
            type="number"
            size="small"
            value={config.thresholds?.warning ?? 50}
            onChange={(e) =>
              onChange({
                ...config,
                thresholds: { good: config.thresholds?.good ?? 10, warning: Number(e.target.value) },
              })
            }
            inputProps={{ min: 0, max: 100 }}
          />

          {/* Dynatrace host-map editor */}
          {config.source === 'dynatrace' && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Typography variant="caption" color="text.secondary">
                Host mapping (current → baseline) — use Dynatrace entity ids as they appear in the series names (e.g. HOST-0A1B2C3D4E5F6789)
              </Typography>
              {(config.hostMap ?? []).map((row, i) => (
                <Box key={i} sx={{ display: 'flex', gap: 1 }}>
                  <TextField size="small" label="Current host" value={row.current}
                    onChange={(e) => { const hm=[...(config.hostMap??[])]; hm[i]={...hm[i]!, current:e.target.value}; onChange({ ...config, hostMap: hm }); }} />
                  <TextField size="small" label="Baseline host" value={row.baseline}
                    onChange={(e) => { const hm=[...(config.hostMap??[])]; hm[i]={...hm[i]!, baseline:e.target.value}; onChange({ ...config, hostMap: hm }); }} />
                  <IconButton size="small" onClick={() => { const hm=[...(config.hostMap??[])]; hm.splice(i,1); onChange({ ...config, hostMap: hm }); }}><DeleteIcon fontSize="small" /></IconButton>
                </Box>
              ))}
              <Button size="small" onClick={() => onChange({ ...config, hostMap: [...(config.hostMap ?? []), { current: '', baseline: '' }] })}>Add host mapping</Button>
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
