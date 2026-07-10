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
import type { ReportSectionType } from '@/lib/api/reports';
import { fetchDynatraceDashboards, fetchDynatraceMetrics } from '@/lib/dynatrace';
import { isGrafana } from '@/lib/metrics-source-utils';
import { BaselineRunSelect, useBaselineCandidates } from './BaselineRunSelect';

// Dynamically import preview components to reduce initial bundle size
const ApdexSectionPreview = dynamic(() => import('./preview/ApdexSectionPreview'), { ssr: false });
const HtmlSectionPreview = dynamic(() => import('./preview/HtmlSectionPreview'), { ssr: false });

// ==================== Shared Section Config Shell ====================

interface SectionConfigShellProps {
  /** Modal title, e.g. "Apdex Score" */
  sectionTitle: string;
  /** Human-readable type label shown in the modal chip, e.g. "Apdex" */
  sectionType: string;
  /** API section type used by the generic server-rendered HTML preview */
  previewType: ReportSectionType;
  /** Current section config (including comment) — sent to the preview endpoint */
  previewConfig: Record<string, unknown>;
  comment?: string;
  onCommentChange: (comment: string) => void;
  testRunId?: string;
  /** Extra per-form condition that disables the preview button */
  previewDisabled?: boolean;
  /** Tooltip shown when previewDisabled is true */
  previewDisabledReason?: string;
  /** Bespoke preview content; defaults to the server-rendered HTML preview */
  previewContent?: React.ReactNode;
  children?: React.ReactNode;
}

/**
 * Shared wrapper that gives every section config form the same affordances:
 * the form's own fields, a Section Comments textarea and a
 * "Preview Section" button that opens the preview modal.
 */
function SectionConfigShell({
  sectionTitle,
  sectionType,
  previewType,
  previewConfig,
  comment,
  onCommentChange,
  testRunId,
  previewDisabled = false,
  previewDisabledReason,
  previewContent,
  children,
}: SectionConfigShellProps) {
  const [previewOpen, setPreviewOpen] = useState(false);

  const disabled = !testRunId || previewDisabled;
  const disabledReason = !testRunId
    ? 'Select a test run to enable preview'
    : previewDisabledReason || 'Preview is not available for the current configuration';

  return (
    <>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {children}

        {/* Comment Text Area */}
        <TextField
          fullWidth
          multiline
          rows={4}
          value={comment || ''}
          onChange={(e) => onCommentChange(e.target.value)}
          placeholder="Add comments or observations about this section..."
          label="Section Comments"
          variant="outlined"
          helperText={`${(comment || '').length} / 2000 characters`}
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
        <Tooltip title={disabled ? disabledReason : ''} arrow>
          <Box component="span" sx={{ display: 'block' }}>
            <Button
              variant="outlined"
              startIcon={<VisibilityIcon />}
              onClick={() => setPreviewOpen(true)}
              fullWidth
              disabled={disabled}
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
        </Tooltip>
      </Box>

      {/* Preview Modal */}
      <SectionPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        sectionTitle={sectionTitle}
        sectionType={sectionType}
        testRunId={testRunId}
        initialComment={comment}
        onSaveComment={onCommentChange}
      >
        {previewContent ?? (
          <HtmlSectionPreview testRunId={testRunId} sectionType={previewType} config={previewConfig} />
        )}
      </SectionPreviewModal>
    </>
  );
}

// ==================== Header Section Config ====================

/** @public */
export interface HeaderConfig {
  text?: string;
  level?: number;
  comment?: string;
}

interface HeaderConfigFormProps {
  config: HeaderConfig;
  onChange: (config: HeaderConfig) => void;
  testRunId?: string;
}

export function HeaderConfigForm({ config, onChange, testRunId }: HeaderConfigFormProps) {
  return (
    <SectionConfigShell
      sectionTitle={config.text || 'Header'}
      sectionType="Header"
      previewType="header"
      previewConfig={{ ...config }}
      comment={config.comment}
      onCommentChange={(comment) => onChange({ ...config, comment })}
      testRunId={testRunId}
    >
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
    </SectionConfigShell>
  );
}

// ==================== Text Block Section Config ====================

/** @public */
export interface TextBlockConfig {
  content?: string;
  fontSize?: number;
  markdown?: boolean;
  alignment?: 'left' | 'center' | 'right' | 'justify';
  comment?: string;
}

interface TextBlockConfigFormProps {
  config: TextBlockConfig;
  onChange: (config: TextBlockConfig) => void;
  testRunId?: string;
}

export function TextBlockConfigForm({ config, onChange, testRunId }: TextBlockConfigFormProps) {
  return (
    <SectionConfigShell
      sectionTitle="Text Block"
      sectionType="Text Block"
      previewType="text_block"
      previewConfig={{ ...config }}
      comment={config.comment}
      onCommentChange={(comment) => onChange({ ...config, comment })}
      testRunId={testRunId}
    >
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
    </SectionConfigShell>
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
  comment?: string;
}

interface SloConfigFormProps {
  config: SloConfig;
  onChange: (config: SloConfig) => void;
  testRunId?: string;
}

export function SloConfigForm({ config, onChange, testRunId }: SloConfigFormProps) {
  return (
    <SectionConfigShell
      sectionTitle="Service Level Objectives"
      sectionType="SLO"
      previewType="slo"
      previewConfig={{ ...config }}
      comment={config.comment}
      onCommentChange={(comment) => onChange({ ...config, comment })}
      testRunId={testRunId}
    >
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
    </SectionConfigShell>
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
  return (
    <SectionConfigShell
      sectionTitle="Apdex Score"
      sectionType="Apdex"
      previewType="apdex"
      previewConfig={{ ...config }}
      comment={config.comment}
      onCommentChange={(comment) => onChange({ ...config, comment })}
      testRunId={testRunId}
      previewContent={<ApdexSectionPreview testRunId={testRunId} config={config} />}
    >
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
    </SectionConfigShell>
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

  return (
    <SectionConfigShell
      sectionTitle={`Response Times - ${config.scenario || 'N/A'}`}
      sectionType="Transaction Response Times"
      previewType="transaction_response_times"
      previewConfig={{ ...config }}
      comment={config.comment}
      onCommentChange={(comment) => onChange({ ...config, comment })}
      testRunId={testRunId}
      previewDisabled={!config.scenario}
      previewDisabledReason="Select a scenario to enable preview"
    >
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
    </SectionConfigShell>
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
  comment?: string;
}

interface RegressionsConfigFormProps {
  config: RegressionsConfig;
  onChange: (config: RegressionsConfig) => void;
  testRunId?: string;
}

export function RegressionsConfigForm({ config, onChange, testRunId }: RegressionsConfigFormProps) {
  return (
    <SectionConfigShell
      sectionTitle="Performance Regressions"
      sectionType="Regressions"
      previewType="regressions"
      previewConfig={{ ...config }}
      comment={config.comment}
      onCommentChange={(comment) => onChange({ ...config, comment })}
      testRunId={testRunId}
    >
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
    </SectionConfigShell>
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
  comment?: string;
}

interface GraphsConfigFormProps {
  config: GraphsConfig;
  onChange: (config: GraphsConfig) => void;
  testRunId?: string;
}

export function GraphsConfigForm({ config, onChange, testRunId }: GraphsConfigFormProps) {
  return (
    <SectionConfigShell
      sectionTitle="Custom Graphs"
      sectionType="Graphs"
      previewType="graphs"
      previewConfig={{ ...config }}
      comment={config.comment}
      onCommentChange={(comment) => onChange({ ...config, comment })}
      testRunId={testRunId}
    >
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
    </SectionConfigShell>
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
  comment?: string;
}

interface AwrConfigFormProps {
  config: AwrConfig;
  onChange: (config: AwrConfig) => void;
  testRunId?: string;
}

export function AwrConfigForm({ config, onChange, testRunId }: AwrConfigFormProps) {
  return (
    <SectionConfigShell
      sectionTitle="AWR Analysis"
      sectionType="AWR"
      previewType="awr"
      previewConfig={{ ...config }}
      comment={config.comment}
      onCommentChange={(comment) => onChange({ ...config, comment })}
      testRunId={testRunId}
    >
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
    </SectionConfigShell>
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
  comment?: string;
}

interface TrendsConfigFormProps {
  config: TrendsConfig;
  onChange: (config: TrendsConfig) => void;
  testRunId?: string;
}

export function TrendsConfigForm({ config, onChange, testRunId }: TrendsConfigFormProps) {
  return (
    <SectionConfigShell
      sectionTitle="Trend Charts"
      sectionType="Trends"
      previewType="trends"
      previewConfig={{ ...config }}
      comment={config.comment}
      onCommentChange={(comment) => onChange({ ...config, comment })}
      testRunId={testRunId}
    >
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
    </SectionConfigShell>
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
  // grafana/dynatrace only: scope the comparison to one dashboard and selected panels
  dashboardLabel?: string;
  panels?: { id: number; title: string }[];
  // grafana/dynatrace only: pair current-run dashboards with differently named
  // dashboards from the baseline run's environment
  dashboardMap?: { current: string; baseline: string }[];
  comment?: string;
}

// Panel types the comparison can meaningfully diff (mirrors the compare card).
const COMPARABLE_PANEL_TYPES = ['graph', 'timeseries', 'stat', 'singlestat', 'flamegraph'];

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
  const [sourceDashboards, setSourceDashboards] = useState<SourceDashboardOption[]>([]);
  const [baselineDashboards, setBaselineDashboards] = useState<SourceDashboardOption[]>([]);
  const [sourcePanels, setSourcePanels] = useState<{ id: number; title: string }[]>([]);

  const comparisonMode = config.comparisonMode ?? 'control_group';
  const source = config.source ?? 'performance-metrics';
  const baselineCandidates = useBaselineCandidates(systemUnderTestId, testRunId, comparisonMode === 'baseline_run');
  // The baseline run may live in a different environment/workload — its
  // dashboard list (for the mapping dropdowns) is fetched for THAT scope.
  const baselineCandidate = baselineCandidates.find((c) => c.test_run_id === config.baselineTestRunId);

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

  // Load the BASELINE run's dashboards for the mapping dropdowns (its env/workload
  // may differ from the current run's — that's the point of the mapping)
  const baselineEnv = baselineCandidate?.test_environment;
  const baselineWorkload = baselineCandidate?.workload;
  useEffect(() => {
    if (comparisonMode !== 'baseline_run' || source === 'performance-metrics' || !systemUnderTestId || !baselineEnv) {
      setBaselineDashboards([]);
      return;
    }
    if (source === 'grafana') {
      const params = new URLSearchParams({ systemId: systemUnderTestId, environment: baselineEnv });
      authenticatedFetch(`/grafana/application-dashboards?${params.toString()}`)
        .then((res) => (res.ok ? res.json() : undefined))
        .then((data: { dashboard_label?: string; dashboard_uid?: string; source_type?: string }[] | undefined) => {
          if (!Array.isArray(data)) { setBaselineDashboards([]); return; }
          setBaselineDashboards(
            data.filter((d) => isGrafana(d) && d.dashboard_label)
              .map((d) => ({ label: d.dashboard_label as string, uid: d.dashboard_uid })),
          );
        })
        .catch(() => setBaselineDashboards([]));
    } else if (baselineWorkload) {
      fetchDynatraceDashboards(systemUnderTestId, baselineEnv, baselineWorkload)
        .then((data) => setBaselineDashboards(data.map((d) => ({ label: d.dashboardLabel }))))
        .catch(() => setBaselineDashboards([]));
    }
  }, [comparisonMode, source, systemUnderTestId, baselineEnv, baselineWorkload]);

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
    <SectionConfigShell
      sectionTitle="Test Comparisons"
      sectionType="Comparisons"
      previewType="comparisons"
      previewConfig={{ ...config }}
      comment={config.comment}
      onCommentChange={(comment) => onChange({ ...config, comment })}
      testRunId={testRunId}
    >
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
          {/* Baseline run selector — shared compare-card-style Autocomplete */}
          <BaselineRunSelect
            candidates={baselineCandidates}
            value={config.baselineTestRunId}
            onChange={(c) => onChange({ ...config, baselineTestRunId: c?.test_run_id })}
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
                  dashboardMap: undefined,
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

          {/* Dashboard-map editor (grafana + dynatrace): pair a current-run dashboard
              with a differently named dashboard from the baseline run's environment */}
          {source !== 'performance-metrics' && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Typography variant="caption" color="text.secondary">
                Dashboard mapping (current → baseline) — map when the baseline run&apos;s dashboards have different names (e.g. per-environment dashboards)
              </Typography>
              {(config.dashboardMap ?? []).map((row, i) => (
                <Box key={i} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  <Autocomplete
                    options={sourceDashboards.map((d) => d.label)}
                    value={row.current || null}
                    onChange={(_, v) => { const dm = [...(config.dashboardMap ?? [])]; dm[i] = { ...dm[i]!, current: v ?? '' }; onChange({ ...config, dashboardMap: dm }); }}
                    size="small"
                    sx={{ flex: 1 }}
                    renderInput={(params) => <TextField {...params} label="Current dashboard" />}
                  />
                  <Autocomplete
                    options={baselineDashboards.map((d) => d.label)}
                    value={row.baseline || null}
                    onChange={(_, v) => { const dm = [...(config.dashboardMap ?? [])]; dm[i] = { ...dm[i]!, baseline: v ?? '' }; onChange({ ...config, dashboardMap: dm }); }}
                    size="small"
                    sx={{ flex: 1 }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Baseline dashboard"
                        helperText={!config.baselineTestRunId ? 'Select a baseline run first' : undefined}
                      />
                    )}
                  />
                  <IconButton size="small" onClick={() => { const dm = [...(config.dashboardMap ?? [])]; dm.splice(i, 1); onChange({ ...config, dashboardMap: dm }); }}><DeleteIcon fontSize="small" /></IconButton>
                </Box>
              ))}
              <Button size="small" onClick={() => onChange({ ...config, dashboardMap: [...(config.dashboardMap ?? []), { current: '', baseline: '' }] })}>Add dashboard mapping</Button>
            </Box>
          )}
        </>
      )}
    </SectionConfigShell>
  );
}
