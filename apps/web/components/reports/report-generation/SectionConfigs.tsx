'use client';

/**
 * Section Configuration Forms
 *
 * Provides configuration UI for each report section type
 */

import { useState, useEffect, useMemo } from 'react';
import { Autocomplete, Box, TextField, Select, MenuItem, FormControlLabel, Switch, Typography, Button, Tooltip, FormControl, InputLabel, Checkbox, IconButton, ListItemText, OutlinedInput } from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import DeleteIcon from '@mui/icons-material/Delete';
import SectionPreviewModal from './SectionPreviewModal';
import dynamic from 'next/dynamic';
import { authenticatedFetch } from '@/lib/api';
import type { ReportSectionType, ReportSectionConfig } from '@/lib/api/reports';
import { REPORT_LIMITS } from '@/lib/api/reports';
import { fetchDynatraceDashboards, fetchDynatraceMetrics } from '@/lib/dynatrace';
import { isGrafana } from '@/lib/metrics-source-utils';
import { GraphPresetsAPI, type GraphPreset } from '@/lib/graph-presets';
import { BaselineRunSelect, useBaselineCandidates } from './BaselineRunSelect';
import { MetricSelectionCascade, useSourceDashboards } from './MetricSelectionCascade';
import { MarkdownField } from './MarkdownField';
import { TEXT_BLOCK_MARKDOWN_DEFAULT, assignSectionAnchors } from '@perfana/shared/utils';
import { SECTION_RENDER_TITLES, isLinkableSectionType } from '@perfana/shared/types';

// Dynamically import preview components to reduce initial bundle size
const ApdexSectionPreview = dynamic(() => import('./preview/ApdexSectionPreview'), { ssr: false });
const HtmlSectionPreview = dynamic(() => import('./preview/HtmlSectionPreview'), { ssr: false });

/**
 * Link targets a MarkdownField's toolbar can offer: every linkable section
 * (per `isLinkableSectionType` — see packages/shared/src/types/reports.types.ts)
 * in the builder's current order, using the same effective-title rule the API
 * applies when it renders the report (SECTION_RENDER_TITLES — same file) so
 * the anchor computed here always matches the `id` the API stamps onto the
 * rendered heading. `text_block`, `header` and `index` sections are excluded:
 * a text block renders as body prose, never a heading with an id; a header
 * is the report's title block at the very top, so linking to it is pointless;
 * an index linking to an index is circular noise.
 */
export function buildLinkTargets(
  allSections: ReportSectionConfig[] = [],
): { title: string; anchor: string }[] {
  const targets = allSections
    .filter((s) => isLinkableSectionType(s.type))
    .sort((a, b) => a.order - b.order);

  const titleOf = (s: ReportSectionConfig) => s.title || SECTION_RENDER_TITLES[s.type];
  const anchors = assignSectionAnchors(targets, titleOf, (s) => s.type);

  return targets.map((s) => ({
    title: titleOf(s),
    anchor: anchors.get(s) as string,
  }));
}

// ==================== Shared Section Config Shell ====================

interface SectionConfigShellProps {
  /** Modal title, e.g. "Apdex Score" */
  sectionTitle: string;
  /** Human-readable type label shown in the modal chip, e.g. "Apdex" */
  sectionType: string;
  /** API section type used by the generic server-rendered HTML preview */
  previewType: ReportSectionType;
  /** Current section config — config only; accompanying text is separate */
  previewConfig: object;
  /**
   * Accompanying text. Omit both this and onTextChange to render no text
   * editor — text_block sections, whose Content field already is the text.
   */
  text?: string;
  onTextChange?: (text: string) => void;
  testRunId?: string;
  allSections?: ReportSectionConfig[];
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
 * the form's own fields, an accompanying-text editor and a "Preview Section"
 * button that opens the preview modal.
 */
function SectionConfigShell({
  sectionTitle,
  sectionType,
  previewType,
  previewConfig,
  text,
  onTextChange,
  testRunId,
  allSections,
  previewDisabled = false,
  previewDisabledReason,
  previewContent,
  children,
}: SectionConfigShellProps) {
  const [previewOpen, setPreviewOpen] = useState(false);

  const linkTargets = useMemo(() => buildLinkTargets(allSections), [allSections]);

  // Local draft of the text so typing doesn't propagate to the parent (and
  // re-render every section card) on each keystroke; committed on blur and
  // before opening the preview modal.
  const [localText, setLocalText] = useState(text ?? '');

  // Sync the draft when the text changes externally (e.g. saved from the
  // preview modal).
  useEffect(() => {
    setLocalText(text ?? '');
  }, [text]);

  const commitText = () => {
    if (onTextChange && localText !== (text ?? '')) {
      onTextChange(localText);
    }
  };

  const disabled = !testRunId || previewDisabled;
  const disabledReason = !testRunId
    ? 'Select a test run to enable preview'
    : previewDisabledReason || 'Preview is not available for the current configuration';

  return (
    <>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {children}

        {/* Accompanying text — same editor as the text block body, so every
            section gets the formatting toolbar and preview. */}
        {onTextChange && (
          <MarkdownField
            label="Text"
            value={localText}
            onChange={setLocalText}
            onBlur={commitText}
            placeholder="Write the text that accompanies this section, or use the buttons above to format it"
            rows={4}
            maxLength={REPORT_LIMITS.MAX_SECTION_TEXT_LENGTH}
            helperText={`${localText.length} / ${REPORT_LIMITS.MAX_SECTION_TEXT_LENGTH} characters`}
            linkTargets={linkTargets}
          />
        )}

        {/* Preview Button */}
        <Tooltip title={disabled ? disabledReason : ''} arrow>
          <Box component="span" sx={{ display: 'block' }}>
            <Button
              variant="outlined"
              startIcon={<VisibilityIcon />}
              onClick={() => {
                // Commit any in-progress draft so the preview payload includes
                // the latest text.
                commitText();
                setPreviewOpen(true);
              }}
              fullWidth
              disabled={disabled}
              sx={{
                textTransform: 'none',
                fontWeight: 600,
                borderColor: 'primary.main',
                color: 'primary.main',
                py: 1.5,
                '&:hover': {
                  borderColor: 'primary.dark',
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
        initialText={localText}
        onSaveText={onTextChange}
        linkTargets={linkTargets}
      >
        {previewContent ?? (
          <HtmlSectionPreview
            testRunId={testRunId}
            sectionType={previewType}
            config={previewConfig}
            text={localText}
          />
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
}

interface HeaderConfigFormProps {
  config: HeaderConfig;
  onChange: (config: HeaderConfig) => void;
  text?: string;
  onTextChange: (text: string) => void;
  testRunId?: string;
  allSections?: ReportSectionConfig[];
}

export function HeaderConfigForm({ config, onChange, text, onTextChange, testRunId, allSections }: HeaderConfigFormProps) {
  return (
    <SectionConfigShell
      sectionTitle={config.text || 'Header'}
      sectionType="Header"
      previewType="header"
      previewConfig={config}
      text={text}
      onTextChange={onTextChange}
      testRunId={testRunId}
      allSections={allSections}
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
}

interface TextBlockConfigFormProps {
  config: TextBlockConfig;
  onChange: (config: TextBlockConfig) => void;
  testRunId?: string;
  allSections?: ReportSectionConfig[];
}

// A text block has no accompanying text — its Content field already is the
// text, so the shell gets no text/onTextChange and renders no second editor.
export function TextBlockConfigForm({ config, onChange, testRunId, allSections }: TextBlockConfigFormProps) {
  const linkTargets = useMemo(() => buildLinkTargets(allSections), [allSections]);

  return (
    <SectionConfigShell
      sectionTitle="Text Block"
      sectionType="Text Block"
      previewType="text_block"
      previewConfig={config}
      testRunId={testRunId}
      allSections={allSections}
    >
      <MarkdownField
        label="Content"
        value={config.content || ''}
        onChange={(content) => onChange({ ...config, content })}
        markdown={config.markdown ?? TEXT_BLOCK_MARKDOWN_DEFAULT}
        placeholder="Write your text here, or use the buttons above to format it"
        linkTargets={linkTargets}
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
            checked={config.markdown ?? TEXT_BLOCK_MARKDOWN_DEFAULT}
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
  showFailureDetails?: boolean;
}

interface SloConfigFormProps {
  config: SloConfig;
  onChange: (config: SloConfig) => void;
  text?: string;
  onTextChange: (text: string) => void;
  testRunId?: string;
  allSections?: ReportSectionConfig[];
}

export function SloConfigForm({ config, onChange, text, onTextChange, testRunId, allSections }: SloConfigFormProps) {
  return (
    <SectionConfigShell
      sectionTitle="Service Level Objectives"
      sectionType="SLO"
      previewType="slo"
      previewConfig={config}
      text={text}
      onTextChange={onTextChange}
      testRunId={testRunId}
      allSections={allSections}
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
            checked={config.showFailureDetails ?? false}
            onChange={(e) => onChange({ ...config, showFailureDetails: e.target.checked })}
          />
        }
        label="Show details in case of failure"
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
}

interface ApdexConfigFormProps {
  config: ApdexConfig;
  onChange: (config: ApdexConfig) => void;
  text?: string;
  onTextChange: (text: string) => void;
  testRunId?: string; // Optional test run ID for preview
  allSections?: ReportSectionConfig[];
}

export function ApdexConfigForm({ config, onChange, text, onTextChange, testRunId, allSections }: ApdexConfigFormProps) {
  return (
    <SectionConfigShell
      sectionTitle="Apdex Score"
      sectionType="Apdex"
      previewType="apdex"
      previewConfig={config}
      text={text}
      onTextChange={onTextChange}
      testRunId={testRunId}
      allSections={allSections}
      previewContent={<ApdexSectionPreview testRunId={testRunId} config={config} text={text} />}
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
  /** Empty or absent = every scenario in the run. */
  scenarios?: string[];
  /** Older templates stored a single name here; "all" meant no filter. */
  scenario?: string;
  includeAggregated?: boolean;
  includeChildRequests?: boolean;
}

interface TransactionResponseTimesConfigFormProps {
  config: TransactionResponseTimesConfig;
  onChange: (config: TransactionResponseTimesConfig) => void;
  text?: string;
  onTextChange: (text: string) => void;
  testRunId?: string; // Optional test run ID for fetching scenarios and preview
  allSections?: ReportSectionConfig[];
}

export function TransactionResponseTimesConfigForm({ config, onChange, text, onTextChange, testRunId, allSections }: TransactionResponseTimesConfigFormProps) {
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

  // A legacy single-scenario config is shown as a one-item selection, so
  // opening an old template and saving it migrates it without losing the choice.
  const selectedScenarios = config.scenarios
    ?? (config.scenario && config.scenario !== 'all' ? [config.scenario] : []);

  const writeScenarios = (next: string[]) => {
    // Drop the superseded single-value key rather than leaving two sources of truth.
    const { scenario: _legacy, ...rest } = config;
    onChange({ ...rest, scenarios: next });
  };

  return (
    <SectionConfigShell
      sectionTitle={`Response Times - ${selectedScenarios.join(', ') || 'All scenarios'}`}
      sectionType="Transaction Response Times"
      previewType="transaction_response_times"
      previewConfig={config}
      text={text}
      onTextChange={onTextChange}
      testRunId={testRunId}
      allSections={allSections}
    >
      {/* Scenarios (multi-select; empty = all) — dropdown when the run's
          scenarios are known, free text otherwise */}
      <Typography variant="caption" color="text.secondary">Scenarios (empty = all)</Typography>
      {scenarios.length > 0 ? (
        <Select
          multiple
          value={selectedScenarios}
          onChange={(e) => {
            const value = e.target.value as string[];
            writeScenarios(typeof value === 'string' ? [value] : value);
          }}
          input={<OutlinedInput />}
          renderValue={(selected) => (selected as string[]).join(', ') || 'All scenarios'}
          fullWidth
          size="small"
          displayEmpty
          disabled={loadingScenarios}
        >
          {scenarios.map((scenario) => (
            <MenuItem key={scenario} value={scenario}>
              <Checkbox checked={selectedScenarios.includes(scenario)} />
              <ListItemText primary={scenario} />
            </MenuItem>
          ))}
        </Select>
      ) : (
        <TextField
          label="Scenario names (comma separated)"
          value={selectedScenarios.join(', ')}
          onChange={(e) =>
            writeScenarios(e.target.value.split(',').map((n) => n.trim()).filter(Boolean))
          }
          fullWidth
          size="small"
          placeholder="e.g., BrowseAndSearch, LoginFlow"
          disabled={loadingScenarios}
          helperText={
            loadingScenarios
              ? 'Loading scenarios...'
              : !testRunId
                ? 'No test run selected - enter scenario names manually, or leave empty for all'
                : 'No scenarios found for this test run - enter manually, or leave empty for all'
          }
        />
      )}

      <FormControlLabel
        control={
          <Switch
            checked={config.includeAggregated ?? false}
            onChange={(e) => onChange({ ...config, includeAggregated: e.target.checked })}
          />
        }
        label="Include 'All aggregated' series"
      />

      <FormControlLabel
        control={
          <Switch
            checked={config.includeChildRequests ?? false}
            onChange={(e) => onChange({ ...config, includeChildRequests: e.target.checked })}
          />
        }
        label="Include child requests"
      />

      {/* Debug info */}
      {process.env.NODE_ENV === 'development' && (
        <Typography variant="caption" color="text.secondary">
          Debug: testRunId={testRunId || 'undefined'}, scenarios={scenarios.length}, loading={loadingScenarios.toString()}
        </Typography>
      )}
    </SectionConfigShell>
  );
}

// ==================== Top 10 Lists Config ====================

const TOP10_LIST_OPTIONS: Array<{ key: NonNullable<Top10ListsConfig['lists']>[number]; label: string }> = [
  { key: 'slowest', label: 'Slowest Average Response Times' },
  { key: 'throughput', label: 'Highest Throughput' },
  { key: 'impact', label: 'Highest Performance Impact' },
  { key: 'error_rate', label: 'Highest Error Rate' },
];

const ALL_TOP10_LIST_KEYS = TOP10_LIST_OPTIONS.map((o) => o.key);

/** @public */
export interface Top10ListsConfig {
  scope?: 'transactions' | 'requests' | 'urls';
  lists?: Array<'slowest' | 'throughput' | 'impact' | 'error_rate'>;
  scenarios?: string[];
  excludeRampUp?: boolean;
  includeUrl?: boolean;
}

interface Top10ListsConfigFormProps {
  config: Top10ListsConfig;
  onChange: (config: Top10ListsConfig) => void;
  text?: string;
  onTextChange: (text: string) => void;
  testRunId?: string;
  allSections?: ReportSectionConfig[];
}

export function Top10ListsConfigForm({ config, onChange, text, onTextChange, testRunId, allSections }: Top10ListsConfigFormProps) {
  const [scenarios, setScenarios] = useState<string[]>([]);

  useEffect(() => {
    if (!testRunId) return;
    const fetchScenarios = async () => {
      try {
        const response = await authenticatedFetch(`/test-runs/${testRunId}/transactions`, { method: 'GET' });
        if (!response.ok) return;
        const transactions = await response.json();
        if (!Array.isArray(transactions)) return;
        const unique = Array.from(
          new Set(transactions.map((t: { scenario_name?: string }) => t.scenario_name).filter(Boolean)),
        );
        setScenarios(unique as string[]);
      } catch {
        setScenarios([]);
      }
    };
    fetchScenarios();
  }, [testRunId]);

  const scope = config.scope ?? 'transactions';
  const selectedLists = config.lists && config.lists.length > 0 ? config.lists : ALL_TOP10_LIST_KEYS;
  const selectedScenarios = config.scenarios ?? [];

  return (
    <SectionConfigShell
      sectionTitle="Top 10 Lists"
      sectionType="Top 10 Lists"
      previewType="top_10_lists"
      previewConfig={config}
      text={text}
      onTextChange={onTextChange}
      testRunId={testRunId}
      allSections={allSections}
    >
      {/* Scope */}
      <Typography variant="caption" color="text.secondary">Scope</Typography>
      <Select
        value={scope}
        onChange={(e) => onChange({ ...config, scope: e.target.value as Top10ListsConfig['scope'] })}
        fullWidth
        size="small"
      >
        <MenuItem value="transactions">Transactions</MenuItem>
        <MenuItem value="requests">Requests</MenuItem>
        <MenuItem value="urls">URLs</MenuItem>
      </Select>

      {/* Lists (multi-select) */}
      <Typography variant="caption" color="text.secondary">Lists to include</Typography>
      <Select
        multiple
        value={selectedLists}
        onChange={(e) => {
          const value = e.target.value as Top10ListsConfig['lists'];
          onChange({ ...config, lists: Array.isArray(value) ? value : [] });
        }}
        input={<OutlinedInput />}
        renderValue={(selected) =>
          TOP10_LIST_OPTIONS.filter((o) => (selected as string[]).includes(o.key)).map((o) => o.label).join(', ')
        }
        fullWidth
        size="small"
      >
        {TOP10_LIST_OPTIONS.map((o) => (
          <MenuItem key={o.key} value={o.key}>
            <Checkbox checked={selectedLists.includes(o.key)} />
            <ListItemText primary={o.label} />
          </MenuItem>
        ))}
      </Select>

      {/* Scenarios (multi-select; empty = all) */}
      {scenarios.length > 0 && (
        <>
          <Typography variant="caption" color="text.secondary">Scenarios (empty = all)</Typography>
          <Select
            multiple
            value={selectedScenarios}
            onChange={(e) => {
              const value = e.target.value as string[];
              onChange({ ...config, scenarios: typeof value === 'string' ? [value] : value });
            }}
            input={<OutlinedInput />}
            renderValue={(selected) => (selected as string[]).join(', ') || 'All scenarios'}
            fullWidth
            size="small"
          >
            {scenarios.map((s) => (
              <MenuItem key={s} value={s}>
                <Checkbox checked={selectedScenarios.includes(s)} />
                <ListItemText primary={s} />
              </MenuItem>
            ))}
          </Select>
        </>
      )}

      {/* includeUrl — requests scope only, mirrors the Compare/Perf-Analysis URL toggle */}
      {scope === 'requests' && (
        <FormControlLabel
          control={
            <Switch
              checked={config.includeUrl ?? false}
              onChange={(e) => onChange({ ...config, includeUrl: e.target.checked })}
            />
          }
          label="Show URL"
        />
      )}
    </SectionConfigShell>
  );
}

// ==================== Error Analysis Config ====================

/** @public */
export interface ErrorAnalysisConfig {
  /** Empty or absent = every scenario in the run. */
  scenarios?: string[];
  /** Restrict to the analysis window (after ramp-up, before ramp-down). */
  excludeRampUp?: boolean;
  includeChart?: boolean;
  /** Rows in the per-request table before it is capped. */
  topN?: number;
}

interface ErrorAnalysisConfigFormProps {
  config: ErrorAnalysisConfig;
  onChange: (config: ErrorAnalysisConfig) => void;
  text?: string;
  onTextChange: (text: string) => void;
  testRunId?: string;
  allSections?: ReportSectionConfig[];
}

export function ErrorAnalysisConfigForm({ config, onChange, text, onTextChange, testRunId, allSections }: ErrorAnalysisConfigFormProps) {
  const [scenarios, setScenarios] = useState<string[]>([]);

  useEffect(() => {
    if (!testRunId) return;
    let cancelled = false;
    const fetchScenarios = async () => {
      try {
        const response = await authenticatedFetch(`/test-runs/${testRunId}/transactions`, { method: 'GET' });
        if (!response.ok) return;
        const transactions = await response.json();
        if (!Array.isArray(transactions) || cancelled) return;
        setScenarios(Array.from(
          new Set(transactions.map((t: { scenario_name?: string }) => t.scenario_name).filter(Boolean)),
        ) as string[]);
      } catch {
        if (!cancelled) setScenarios([]);
      }
    };
    fetchScenarios();
    return () => { cancelled = true; };
  }, [testRunId]);

  const selectedScenarios = config.scenarios ?? [];

  return (
    <SectionConfigShell
      sectionTitle="Error Analysis"
      sectionType="Error Analysis"
      previewType="error_analysis"
      previewConfig={config}
      text={text}
      onTextChange={onTextChange}
      testRunId={testRunId}
      allSections={allSections}
    >
      {scenarios.length > 0 && (
        <>
          <Typography variant="caption" color="text.secondary">Scenarios (empty = all)</Typography>
          <Select
            multiple
            value={selectedScenarios}
            onChange={(e) => {
              const value = e.target.value as string[];
              onChange({ ...config, scenarios: typeof value === 'string' ? [value] : value });
            }}
            input={<OutlinedInput />}
            renderValue={(selected) => (selected as string[]).join(', ') || 'All scenarios'}
            fullWidth
            size="small"
            displayEmpty
          >
            {scenarios.map((s) => (
              <MenuItem key={s} value={s}>
                <Checkbox checked={selectedScenarios.includes(s)} />
                <ListItemText primary={s} />
              </MenuItem>
            ))}
          </Select>
        </>
      )}

      <FormControlLabel
        control={
          <Switch
            checked={config.includeChart ?? true}
            onChange={(e) => onChange({ ...config, includeChart: e.target.checked })}
          />
        }
        label="Include errors-over-time chart"
      />

      <FormControlLabel
        control={
          <Switch
            checked={config.excludeRampUp ?? true}
            onChange={(e) => onChange({ ...config, excludeRampUp: e.target.checked })}
          />
        }
        label="Analysis timerange only (exclude ramp-up / ramp-down)"
      />

      <TextField
        label="Max failing requests listed"
        type="number"
        value={config.topN ?? 20}
        onChange={(e) => onChange({ ...config, topN: Number(e.target.value) })}
        size="small"
        inputProps={{ min: 1, max: 200 }}
        helperText="The rest are summarised as 'and N more'."
      />

      <Typography variant="caption" color="text.secondary">
        Counts and rates only. Response bodies, headers and cookies are never included — reports can be
        downloaded and shared by link.
      </Typography>
    </SectionConfigShell>
  );
}

// ==================== Regressions Config ====================

/** @public */
export interface RegressionsConfig {
  maxItems?: number;
  showImprovements?: boolean;
}

interface RegressionsConfigFormProps {
  config: RegressionsConfig;
  onChange: (config: RegressionsConfig) => void;
  text?: string;
  onTextChange: (text: string) => void;
  testRunId?: string;
  allSections?: ReportSectionConfig[];
}

export function RegressionsConfigForm({ config, onChange, text, onTextChange, testRunId, allSections }: RegressionsConfigFormProps) {
  return (
    <SectionConfigShell
      sectionTitle="Anomaly Detection"
      sectionType="Anomaly Detection"
      previewType="regressions"
      previewConfig={config}
      text={text}
      onTextChange={onTextChange}
      testRunId={testRunId}
      allSections={allSections}
    >
      <TextField
        label="Max Items"
        type="number"
        value={config.maxItems ?? 50}
        onChange={(e) => onChange({ ...config, maxItems: Number(e.target.value) })}
        size="small"
        inputProps={{ min: 1, max: 100 }}
      />
      <FormControlLabel
        control={
          <Switch
            checked={config.showImprovements ?? false}
            onChange={(e) => onChange({ ...config, showImprovements: e.target.checked })}
          />
        }
        label="Show Improvements"
      />
    </SectionConfigShell>
  );
}

// ==================== Graphs Config ====================

/** @public */
export interface GraphsConfig {
  /** Graph presets saved from the Graphs card; empty = auto-discover panels. */
  graphPresetIds?: string[];
  panels?: string[];
  quality?: 'low' | 'standard' | 'high';
  timeRange?: {
    startOffset?: number;
    endOffset?: number;
  };
  showLegends?: boolean;
  /**
   * No longer offered by the form. Kept on the type so a template saved before
   * the toggle was removed still type-checks and keeps rendering as it did.
   */
  includeAggregated?: boolean;
}

interface GraphsConfigFormProps {
  config: GraphsConfig;
  onChange: (config: GraphsConfig) => void;
  text?: string;
  onTextChange: (text: string) => void;
  testRunId?: string;
  allSections?: ReportSectionConfig[];
}

export function GraphsConfigForm({ config, onChange, text, onTextChange, testRunId, allSections }: GraphsConfigFormProps) {
  const [presets, setPresets] = useState<GraphPreset[]>([]);
  const [loadingPresets, setLoadingPresets] = useState(false);

  // The same list the Graphs card shows for this run: its own presets plus the
  // global ones.
  useEffect(() => {
    let cancelled = false;
    const fetchPresets = async () => {
      setLoadingPresets(true);
      try {
        const all = await GraphPresetsAPI.getAll(testRunId);
        if (!cancelled) setPresets(all);
      } catch {
        if (!cancelled) setPresets([]);
      } finally {
        if (!cancelled) setLoadingPresets(false);
      }
    };
    fetchPresets();
    return () => { cancelled = true; };
  }, [testRunId]);

  const selectedPresetIds = config.graphPresetIds ?? [];
  const nameOf = (id: string) => presets.find((p) => p.id === id)?.name ?? id;

  return (
    <SectionConfigShell
      sectionTitle="Custom Graphs"
      sectionType="Graphs"
      previewType="graphs"
      previewConfig={config}
      text={text}
      onTextChange={onTextChange}
      testRunId={testRunId}
      allSections={allSections}
    >
      {/* Graph presets — the section's series selection. Empty means the
          renderer auto-discovers this run's panels, as it always has. */}
      <Typography variant="caption" color="text.secondary">
        Graph presets (empty = auto-discover panels)
      </Typography>
      <Select
        multiple
        value={selectedPresetIds}
        onChange={(e) => {
          const value = e.target.value as string[];
          onChange({ ...config, graphPresetIds: typeof value === 'string' ? [value] : value });
        }}
        input={<OutlinedInput />}
        renderValue={(selected) =>
          (selected as string[]).map(nameOf).join(', ') || 'Auto-discover panels'
        }
        fullWidth
        size="small"
        displayEmpty
        disabled={loadingPresets || presets.length === 0}
      >
        {presets.map((preset) => (
          <MenuItem key={preset.id} value={preset.id}>
            <Checkbox checked={selectedPresetIds.includes(preset.id)} />
            <ListItemText
              primary={preset.name}
              secondary={`${preset.seriesConfig?.length ?? 0} series${preset.isGlobal ? ' · global' : ''}`}
            />
          </MenuItem>
        ))}
      </Select>
      {presets.length === 0 && !loadingPresets && (
        <Typography variant="caption" color="text.secondary">
          No graph presets found. Save one from the Graphs card on a test run first.
        </Typography>
      )}

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
}

interface AwrConfigFormProps {
  config: AwrConfig;
  onChange: (config: AwrConfig) => void;
  text?: string;
  onTextChange: (text: string) => void;
  testRunId?: string;
  allSections?: ReportSectionConfig[];
}

export function AwrConfigForm({ config, onChange, text, onTextChange, testRunId, allSections }: AwrConfigFormProps) {
  return (
    <SectionConfigShell
      sectionTitle="AWR Analysis"
      sectionType="AWR"
      previewType="awr"
      previewConfig={config}
      text={text}
      onTextChange={onTextChange}
      testRunId={testRunId}
      allSections={allSections}
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
/** Sentinel meaning "start at ADAPT's most recent change point" (CHANGE_POINT_WINDOW in the API). */
export const TRENDS_CHANGE_POINT = 'changepoint';

export interface TrendsConfig {
  /** Oldest run to include: a test run id, or TRENDS_CHANGE_POINT. */
  oldestTestRunId?: string;
  /** @deprecated run-count window from before the oldest-run picker; still honoured as a cap */
  timeRange?: {
    runCount?: number;
  };
  source?: 'performance-metrics' | 'grafana' | 'dynatrace';
  // Which metric data the per-dashboard trend tables cover. Empty at a level means
  // everything under the level above it.
  dashboardLabels?: string[];
  panels?: { id: number; title: string; dashboardLabel?: string }[];
  series?: { dashboardLabel: string; panelId: number; metricName: string }[];
}

interface TrendsConfigFormProps {
  config: TrendsConfig;
  onChange: (config: TrendsConfig) => void;
  text?: string;
  onTextChange: (text: string) => void;
  testRunId?: string;
  allSections?: ReportSectionConfig[];
  systemUnderTestId?: string;
  testEnvironment?: string;
  workload?: string;
}

export function TrendsConfigForm({
  config, onChange, text, onTextChange, testRunId, systemUnderTestId, testEnvironment, workload, allSections,
}: TrendsConfigFormProps) {
  const source = config.source ?? 'performance-metrics';
  const dashboards = useSourceDashboards(source, systemUnderTestId, testEnvironment, workload);
  const runCandidates = useBaselineCandidates(systemUnderTestId, testRunId);
  const oldest = config.oldestTestRunId ?? TRENDS_CHANGE_POINT;

  return (
    <SectionConfigShell
      sectionTitle="Trend Charts"
      sectionType="Trends"
      previewType="trends"
      previewConfig={config}
      text={text}
      onTextChange={onTextChange}
      testRunId={testRunId}
      allSections={allSections}
    >
      {/* Where the window starts. The default follows ADAPT: everything since the run at
          which it last saw the system change, because older runs describe a system that has
          since moved. Pin a run to override it. */}
      <FormControl size="small" fullWidth>
        <InputLabel id="trends-oldest-label">Oldest test run</InputLabel>
        <Select
          labelId="trends-oldest-label"
          label="Oldest test run"
          value={oldest}
          onChange={(e) => onChange({ ...config, oldestTestRunId: e.target.value })}
        >
          <MenuItem value={TRENDS_CHANGE_POINT}>Most recent change point</MenuItem>
          {runCandidates.map((c) => (
            <MenuItem key={c.test_run_id} value={c.test_run_id}>
              {c.test_run_id}
              {c.application_release ? ` · ${c.application_release}` : ''}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {/* The aggregated run-level trend always leads the section; these pick what is
          tabled underneath it, one table per dashboard. */}
      <FormControl size="small" fullWidth>
        <InputLabel id="trends-source-label">Source</InputLabel>
        <Select
          labelId="trends-source-label"
          label="Source"
          value={source}
          onChange={(e) => onChange({
            ...config,
            source: e.target.value as TrendsConfig['source'],
            dashboardLabels: undefined,
            panels: undefined,
            series: undefined,
          })}
        >
          <MenuItem value="performance-metrics">Performance Metrics</MenuItem>
          <MenuItem value="grafana">Grafana</MenuItem>
          <MenuItem value="dynatrace">Dynatrace</MenuItem>
        </Select>
      </FormControl>

      <MetricSelectionCascade
        source={source}
        dashboards={dashboards}
        systemUnderTestId={systemUnderTestId}
        testEnvironment={testEnvironment}
        workload={workload}
        testRunId={testRunId}
        includeUrlPanels
        value={config}
        onChange={(v) => onChange({ ...config, ...v })}
      />
    </SectionConfigShell>
  );
}

// ==================== Comparisons Config ====================

/** @public */
export interface ComparisonsConfig {
  baselineTestRunId?: string;
  source?: 'performance-metrics' | 'grafana' | 'dynatrace';
  metrics?: ('avg' | 'p90' | 'p95' | 'p99')[];
  thresholds?: { good: number; warning: number; minAbsolute?: number };
  // grafana/dynatrace only: scope the comparison to dashboards, their panels and their
  // series. Each level left empty means "everything below the level above it".
  dashboardLabels?: string[];
  panels?: { id: number; title: string; dashboardLabel?: string }[];
  series?: { dashboardLabel: string; panelId: number; metricName: string }[];
  /** @deprecated single-dashboard key from before multi-select; read on load, never written */
  dashboardLabel?: string;
  // grafana/dynatrace only: pair current-run dashboards with differently named
  // dashboards from the baseline run's environment
  dashboardMap?: { current: string; baseline: string }[];
}

interface ComparisonsConfigFormProps {
  config: ComparisonsConfig;
  onChange: (config: ComparisonsConfig) => void;
  text?: string;
  onTextChange: (text: string) => void;
  testRunId?: string;
  allSections?: ReportSectionConfig[];
  systemUnderTestId?: string;
  testEnvironment?: string;
  workload?: string;
}

export function ComparisonsConfigForm({ config, onChange, text, onTextChange, testRunId, systemUnderTestId, testEnvironment, workload, allSections }: ComparisonsConfigFormProps) {
  const source = config.source ?? 'performance-metrics';
  const baselineCandidates = useBaselineCandidates(systemUnderTestId, testRunId, true);
  // The baseline run may live in a different environment/workload — its
  // dashboard list (for the mapping dropdowns) is fetched for THAT scope.
  const baselineCandidate = baselineCandidates.find((c) => c.test_run_id === config.baselineTestRunId);
  const sourceDashboards = useSourceDashboards(source, systemUnderTestId, testEnvironment, workload);
  const baselineDashboards = useSourceDashboards(
    source, systemUnderTestId, baselineCandidate?.test_environment, baselineCandidate?.workload,
  );

  // Keep in step with the renderer's default (comparisons-renderer.ts).
  const metrics = config.metrics ?? ['avg', 'p90', 'p95'];

  const toggleMetric = (metric: 'avg' | 'p90' | 'p95' | 'p99') => {
    const next = metrics.includes(metric) ? metrics.filter((m) => m !== metric) : [...metrics, metric];
    onChange({ ...config, metrics: next });
  };

  return (
    <SectionConfigShell
      sectionTitle="Test Comparisons"
      sectionType="Comparisons"
      previewType="comparisons"
      previewConfig={config}
      text={text}
      onTextChange={onTextChange}
      testRunId={testRunId}
      allSections={allSections}
      // Without a baseline the preview can only render the "no baseline configured" empty
      // state, so the button offers nothing but a round trip.
      previewDisabled={baselineCandidates.length === 0 || !config.baselineTestRunId}
      previewDisabledReason={
        baselineCandidates.length === 0
          ? 'No baseline run available — this run has no earlier runs in its system, environment and workload'
          : 'Select a baseline run to enable preview'
      }
    >
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
              dashboardLabels: undefined,
              dashboardLabel: undefined,
              panels: undefined,
              series: undefined,
              dashboardMap: undefined,
            })
          }
        >
          <MenuItem value="performance-metrics">Performance Metrics</MenuItem>
          <MenuItem value="grafana">Grafana</MenuItem>
          <MenuItem value="dynatrace">Dynatrace</MenuItem>
        </Select>
      </FormControl>

      {/* Dashboards → panels → series cascade (grafana/dynatrace only) */}
      <MetricSelectionCascade
        source={source}
        dashboards={sourceDashboards}
        systemUnderTestId={systemUnderTestId}
        testEnvironment={testEnvironment}
        workload={workload}
        testRunId={testRunId}
        includeUrlPanels
        value={config}
        onChange={(v) => onChange({ ...config, ...v })}
      />

      {/* Metric checkboxes */}
      <Box>
        <Typography variant="caption" color="text.secondary">Metrics</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {(['avg', 'p90', 'p95', 'p99'] as const).map((m) => (
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
            thresholds: { good: config.thresholds?.good ?? 10, warning: Number(e.target.value), minAbsolute: config.thresholds?.minAbsolute },
          })
        }
        inputProps={{ min: 0, max: 100 }}
      />
      <TextField
        label="Min. absolute change"
        type="number"
        size="small"
        value={config.thresholds?.minAbsolute ?? ''}
        onChange={(e) => {
          const v = e.target.value === '' ? undefined : Number(e.target.value);
          onChange({
            ...config,
            thresholds: { good: config.thresholds?.good ?? 10, warning: config.thresholds?.warning ?? 50, minAbsolute: v },
          });
        }}
        helperText="Changes smaller than this (in the metric's units, e.g. ms) are treated as no difference. Leave empty to disable."
        inputProps={{ min: 0 }}
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
    </SectionConfigShell>
  );
}
