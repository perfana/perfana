'use client';

/**
 * Section Configuration Forms
 *
 * Provides configuration UI for each report section type
 */

import { useState, useEffect } from 'react';
import { Box, TextField, Select, MenuItem, FormControlLabel, Switch, Slider, Typography, Button, Tooltip } from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import SectionPreviewModal from './SectionPreviewModal';
import dynamic from 'next/dynamic';
import { authenticatedFetch } from '@/lib/api';

// Dynamically import preview components to reduce initial bundle size
const ApdexSectionPreview = dynamic(() => import('./preview/ApdexSectionPreview'), { ssr: false });

// ==================== Header Section Config ====================

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
        {/* Exclude Ramp-up Toggle */}
        <Tooltip title="Exclude data during ramp-up time period from all statistics" arrow>
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
            label="Exclude Ramp-up"
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

  // Debug: Log when component renders
  console.log('TransactionResponseTimesConfigForm rendered with testRunId:', testRunId);
  console.log('Current scenarios:', scenarios);

  // Fetch scenarios from transactions table
  useEffect(() => {
    console.log('useEffect triggered, testRunId:', testRunId);
    if (!testRunId) {
      console.log('No testRunId, skipping fetch');
      return;
    }

    const fetchScenarios = async () => {
      setLoadingScenarios(true);
      try {
        console.log('Fetching scenarios for testRunId:', testRunId);
        const response = await authenticatedFetch(
          `/test-runs/${testRunId}/transactions`,
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );

        console.log('Response status:', response.status, response.ok);

        if (!response.ok) {
          const errorText = await response.text();
          console.error('Response error:', errorText);
          throw new Error(`Failed to fetch transactions: ${response.status} ${response.statusText}`);
        }

        const transactions = await response.json();
        console.log('Transactions received:', transactions);
        console.log('Transactions is array?', Array.isArray(transactions));
        console.log('Transactions length:', Array.isArray(transactions) ? transactions.length : 'not an array');

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
        const uniqueScenarios = Array.from(new Set(transactions.map((t: any) => t.scenario_name).filter(Boolean)));
        console.log('Unique scenarios:', uniqueScenarios);
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

export interface ComparisonsConfig {
  showSideBySide?: boolean;
  metricsToCompare?: string[];
  baselineTestRunId?: string;
  autoSelectBaseline?: boolean;
  showDeltaPercentage?: boolean;
  highlightSignificant?: boolean;
  significantChangeThreshold?: number;
}

interface ComparisonsConfigFormProps {
  config: ComparisonsConfig;
  onChange: (config: ComparisonsConfig) => void;
}

export function ComparisonsConfigForm({ config, onChange }: ComparisonsConfigFormProps) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
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
    </Box>
  );
}
