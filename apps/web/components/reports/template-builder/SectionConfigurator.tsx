'use client';

/**
 * Section Configurator Component
 *
 * A comprehensive component for configuring report sections in ad-hoc template building.
 * Supports all 10 section types with type-specific configuration forms, comments,
 * drag-and-drop reordering, and real-time preview.
 *
 * Features:
 * - Section-specific configuration forms
 * - Optional comments for data sections (all except header and text_block)
 * - Drag-and-drop reordering with visual feedback
 * - Inline title editing
 * - Section removal with confirmation
 * - Collapsible section details
 * - Type-specific icons and colors
 *
 * @example
 * ```tsx
 * <SectionConfigurator
 *   sections={sections}
 *   onSectionsChange={setSections}
 *   disabled={isSubmitting}
 * />
 * ```
 */

import { useState, useCallback, useMemo } from 'react';
import {
  Box,
  Typography,
  Paper,
  TextField,
  IconButton,
  Tooltip,
  Collapse,
  Divider,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormControlLabel,
  Checkbox,
  Switch,
  Alert,
  Chip,
  alpha,
} from '@mui/material';
import {
  DragIndicator as DragIcon,
  ArrowUpward as ArrowUpIcon,
  ArrowDownward as ArrowDownIcon,
  Delete as DeleteIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Edit as EditIcon,
  Title as TitleIcon,
  Description as DescriptionIcon,
  Speed as SpeedIcon,
  Timeline as TimelineIcon,
  Timer as TimerIcon,
  TrendingDown as TrendingDownIcon,
  Storage as StorageIcon,
  TrendingUp as TrendingUpIcon,
  CompareArrows as CompareIcon,
  BarChart as BarChartIcon,
  Comment as CommentIcon,
  Settings as SettingsIcon,
} from '@mui/icons-material';
import {
  type ReportSectionConfig,
  type ReportSectionType,
  getSectionTypeLabel,
  isCommentableSection,
  REPORT_LIMITS,
} from '@/lib/api/reports';

// ==================== Types ====================

/**
 * Props for the SectionConfigurator component
 */
export interface SectionConfiguratorProps {
  /** Current sections configuration */
  sections: ReportSectionConfig[];
  /** Callback when sections change */
  onSectionsChange: (sections: ReportSectionConfig[]) => void;
  /** Whether the configurator is disabled */
  disabled?: boolean;
  /** Whether to show drag handles (for drag-and-drop reordering) */
  showDragHandles?: boolean;
  /** Compact mode - less padding, smaller typography */
  compact?: boolean;
}

/**
 * Props for individual section item
 */
interface SectionItemProps {
  section: ReportSectionConfig;
  index: number;
  totalSections: number;
  onUpdate: (index: number, updates: Partial<ReportSectionConfig>) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  onRemove: (index: number) => void;
  disabled?: boolean;
  showDragHandle?: boolean;
  compact?: boolean;
}

// ==================== Section Type Metadata ====================

/**
 * Get icon for section type
 */
function getSectionIcon(type: ReportSectionType): React.ReactNode {
  const iconProps = { fontSize: 'small' as const };
  switch (type) {
    case 'header':
      return <TitleIcon {...iconProps} />;
    case 'text_block':
      return <DescriptionIcon {...iconProps} />;
    case 'slo':
      return <SpeedIcon {...iconProps} />;
    case 'apdex':
      return <TimelineIcon {...iconProps} />;
    case 'transaction_response_times':
      return <TimerIcon {...iconProps} />;
    case 'regressions':
      return <TrendingDownIcon {...iconProps} />;
    case 'awr':
      return <StorageIcon {...iconProps} />;
    case 'trends':
      return <TrendingUpIcon {...iconProps} />;
    case 'comparisons':
      return <CompareIcon {...iconProps} />;
    case 'graphs':
      return <BarChartIcon {...iconProps} />;
    default:
      return <DescriptionIcon {...iconProps} />;
  }
}

/**
 * Section type colors
 */
const SECTION_COLORS: Record<ReportSectionType, string> = {
  header: '#1976d2',
  text_block: '#7c4dff',
  slo: '#4caf50',
  apdex: '#ff9800',
  transaction_response_times: '#2196f3',
  regressions: '#f44336',
  awr: '#9c27b0',
  trends: '#00bcd4',
  comparisons: '#795548',
  graphs: '#607d8b',
};

// ==================== Section-Specific Config Forms ====================

/**
 * Header section configuration
 */
function HeaderConfigForm({
  config,
  onUpdate,
  disabled,
}: {
  config: Record<string, unknown>;
  onUpdate: (updates: Record<string, unknown>) => void;
  disabled?: boolean;
}) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <TextField
        fullWidth
        size="small"
        label="Report Title"
        value={(config.reportTitle as string) || ''}
        onChange={(e) => onUpdate({ reportTitle: e.target.value })}
        disabled={disabled}
        placeholder="Performance Test Report"
      />
      <TextField
        fullWidth
        size="small"
        label="Subtitle (Optional)"
        value={(config.subtitle as string) || ''}
        onChange={(e) => onUpdate({ subtitle: e.target.value })}
        disabled={disabled}
        placeholder="Generated on {date}"
      />
      <FormControlLabel
        control={
          <Checkbox
            checked={(config.showLogo as boolean) ?? true}
            onChange={(e) => onUpdate({ showLogo: e.target.checked })}
            disabled={disabled}
            size="small"
          />
        }
        label="Show logo"
      />
      <FormControlLabel
        control={
          <Checkbox
            checked={(config.showDate as boolean) ?? true}
            onChange={(e) => onUpdate({ showDate: e.target.checked })}
            disabled={disabled}
            size="small"
          />
        }
        label="Show generation date"
      />
    </Box>
  );
}

/**
 * Text block section configuration
 */
function TextBlockConfigForm({
  config,
  onUpdate,
  disabled,
}: {
  config: Record<string, unknown>;
  onUpdate: (updates: Record<string, unknown>) => void;
  disabled?: boolean;
}) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <TextField
        fullWidth
        size="small"
        multiline
        rows={4}
        label="Content"
        value={(config.content as string) || ''}
        onChange={(e) => onUpdate({ content: e.target.value })}
        disabled={disabled}
        placeholder="Enter your text content here..."
        helperText="Supports Markdown formatting"
      />
      <FormControl fullWidth size="small">
        <InputLabel>Text Style</InputLabel>
        <Select
          value={(config.style as string) || 'normal'}
          onChange={(e) => onUpdate({ style: e.target.value })}
          label="Text Style"
          disabled={disabled}
        >
          <MenuItem value="normal">Normal</MenuItem>
          <MenuItem value="info">Information</MenuItem>
          <MenuItem value="warning">Warning</MenuItem>
          <MenuItem value="success">Success</MenuItem>
        </Select>
      </FormControl>
    </Box>
  );
}

/**
 * SLO section configuration
 */
function SloConfigForm({
  config,
  onUpdate,
  disabled,
}: {
  config: Record<string, unknown>;
  onUpdate: (updates: Record<string, unknown>) => void;
  disabled?: boolean;
}) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <FormControlLabel
        control={
          <Switch
            checked={(config.showDetails as boolean) ?? true}
            onChange={(e) => onUpdate({ showDetails: e.target.checked })}
            disabled={disabled}
            size="small"
          />
        }
        label="Show detailed breakdown"
      />
      <FormControlLabel
        control={
          <Switch
            checked={(config.showFailedOnly as boolean) ?? false}
            onChange={(e) => onUpdate({ showFailedOnly: e.target.checked })}
            disabled={disabled}
            size="small"
          />
        }
        label="Show failed SLOs only"
      />
      <FormControl fullWidth size="small">
        <InputLabel>Display Format</InputLabel>
        <Select
          value={(config.displayFormat as string) || 'table'}
          onChange={(e) => onUpdate({ displayFormat: e.target.value })}
          label="Display Format"
          disabled={disabled}
        >
          <MenuItem value="table">Table</MenuItem>
          <MenuItem value="cards">Cards</MenuItem>
          <MenuItem value="summary">Summary Only</MenuItem>
        </Select>
      </FormControl>
    </Box>
  );
}

/**
 * Apdex section configuration
 */
function ApdexConfigForm({
  config,
  onUpdate,
  disabled,
}: {
  config: Record<string, unknown>;
  onUpdate: (updates: Record<string, unknown>) => void;
  disabled?: boolean;
}) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <TextField
        fullWidth
        size="small"
        type="number"
        label="Target Threshold (T) - ms"
        value={(config.targetThreshold as number) || 500}
        onChange={(e) => onUpdate({ targetThreshold: Number(e.target.value) })}
        disabled={disabled}
        inputProps={{ min: 1, max: 60000 }}
      />
      <FormControlLabel
        control={
          <Switch
            checked={(config.showHistogram as boolean) ?? true}
            onChange={(e) => onUpdate({ showHistogram: e.target.checked })}
            disabled={disabled}
            size="small"
          />
        }
        label="Show distribution histogram"
      />
      <FormControlLabel
        control={
          <Switch
            checked={(config.showTransactions as boolean) ?? true}
            onChange={(e) => onUpdate({ showTransactions: e.target.checked })}
            disabled={disabled}
            size="small"
          />
        }
        label="Show per-transaction scores"
      />
    </Box>
  );
}

/**
 * Transaction Response Times section configuration
 */
function TransactionResponseTimesConfigForm({
  config,
  onUpdate,
  disabled,
}: {
  config: Record<string, unknown>;
  onUpdate: (updates: Record<string, unknown>) => void;
  disabled?: boolean;
}) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <FormControl fullWidth size="small">
        <InputLabel>Metrics to Show</InputLabel>
        <Select
          multiple
          value={(config.metrics as string[]) || ['avg', 'p95', 'p99']}
          onChange={(e) => onUpdate({ metrics: e.target.value })}
          label="Metrics to Show"
          disabled={disabled}
          renderValue={(selected) => (selected as string[]).join(', ')}
        >
          <MenuItem value="min">Minimum</MenuItem>
          <MenuItem value="avg">Average</MenuItem>
          <MenuItem value="median">Median (P50)</MenuItem>
          <MenuItem value="p90">P90</MenuItem>
          <MenuItem value="p95">P95</MenuItem>
          <MenuItem value="p99">P99</MenuItem>
          <MenuItem value="max">Maximum</MenuItem>
        </Select>
      </FormControl>
      <TextField
        fullWidth
        size="small"
        type="number"
        label="Top N Transactions"
        value={(config.topN as number) || 10}
        onChange={(e) => onUpdate({ topN: Number(e.target.value) })}
        disabled={disabled}
        inputProps={{ min: 1, max: 100 }}
        helperText="Number of transactions to show"
      />
      <FormControl fullWidth size="small">
        <InputLabel>Sort By</InputLabel>
        <Select
          value={(config.sortBy as string) || 'avg'}
          onChange={(e) => onUpdate({ sortBy: e.target.value })}
          label="Sort By"
          disabled={disabled}
        >
          <MenuItem value="avg">Average Response Time</MenuItem>
          <MenuItem value="p95">P95 Response Time</MenuItem>
          <MenuItem value="count">Request Count</MenuItem>
          <MenuItem value="name">Transaction Name</MenuItem>
        </Select>
      </FormControl>
    </Box>
  );
}

/**
 * Regressions section configuration
 */
function RegressionsConfigForm({
  config,
  onUpdate,
  disabled,
}: {
  config: Record<string, unknown>;
  onUpdate: (updates: Record<string, unknown>) => void;
  disabled?: boolean;
}) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <TextField
        fullWidth
        size="small"
        type="number"
        label="Regression Threshold (%)"
        value={(config.threshold as number) || 10}
        onChange={(e) => onUpdate({ threshold: Number(e.target.value) })}
        disabled={disabled}
        inputProps={{ min: 1, max: 100 }}
        helperText="Percentage change to consider as regression"
      />
      <TextField
        fullWidth
        size="small"
        label="Baseline Run ID (Optional)"
        value={(config.baselineRunId as string) || ''}
        onChange={(e) => onUpdate({ baselineRunId: e.target.value })}
        disabled={disabled}
        placeholder="Leave empty for auto-detection"
      />
      <FormControlLabel
        control={
          <Switch
            checked={(config.showImprovements as boolean) ?? false}
            onChange={(e) => onUpdate({ showImprovements: e.target.checked })}
            disabled={disabled}
            size="small"
          />
        }
        label="Show improvements"
      />
    </Box>
  );
}

/**
 * AWR section configuration
 */
function AwrConfigForm({
  config,
  onUpdate,
  disabled,
}: {
  config: Record<string, unknown>;
  onUpdate: (updates: Record<string, unknown>) => void;
  disabled?: boolean;
}) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <FormControl fullWidth size="small">
        <InputLabel>Sections to Include</InputLabel>
        <Select
          multiple
          value={(config.sections as string[]) || ['sqlStats', 'waitEvents', 'topSql']}
          onChange={(e) => onUpdate({ sections: e.target.value })}
          label="Sections to Include"
          disabled={disabled}
          renderValue={(selected) => (selected as string[]).length + ' selected'}
        >
          <MenuItem value="sqlStats">SQL Statistics</MenuItem>
          <MenuItem value="waitEvents">Wait Events</MenuItem>
          <MenuItem value="topSql">Top SQL</MenuItem>
          <MenuItem value="ioPerfStats">I/O Performance</MenuItem>
          <MenuItem value="memoryStats">Memory Statistics</MenuItem>
        </Select>
      </FormControl>
      <TextField
        fullWidth
        size="small"
        type="number"
        label="Top SQL Statements"
        value={(config.topSqlCount as number) || 10}
        onChange={(e) => onUpdate({ topSqlCount: Number(e.target.value) })}
        disabled={disabled}
        inputProps={{ min: 1, max: 50 }}
      />
    </Box>
  );
}

/**
 * Trends section configuration
 */
function TrendsConfigForm({
  config,
  onUpdate,
  disabled,
}: {
  config: Record<string, unknown>;
  onUpdate: (updates: Record<string, unknown>) => void;
  disabled?: boolean;
}) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <TextField
        fullWidth
        size="small"
        type="number"
        label="Number of Previous Runs"
        value={(config.runsCount as number) || 10}
        onChange={(e) => onUpdate({ runsCount: Number(e.target.value) })}
        disabled={disabled}
        inputProps={{ min: 2, max: 50 }}
      />
      <FormControl fullWidth size="small">
        <InputLabel>Metrics to Track</InputLabel>
        <Select
          multiple
          value={(config.metrics as string[]) || ['avgResponseTime', 'errorRate', 'throughput']}
          onChange={(e) => onUpdate({ metrics: e.target.value })}
          label="Metrics to Track"
          disabled={disabled}
          renderValue={(selected) => (selected as string[]).length + ' selected'}
        >
          <MenuItem value="avgResponseTime">Avg Response Time</MenuItem>
          <MenuItem value="p95ResponseTime">P95 Response Time</MenuItem>
          <MenuItem value="errorRate">Error Rate</MenuItem>
          <MenuItem value="throughput">Throughput</MenuItem>
          <MenuItem value="apdex">Apdex Score</MenuItem>
        </Select>
      </FormControl>
      <FormControlLabel
        control={
          <Switch
            checked={(config.showTrendLine as boolean) ?? true}
            onChange={(e) => onUpdate({ showTrendLine: e.target.checked })}
            disabled={disabled}
            size="small"
          />
        }
        label="Show trend lines"
      />
    </Box>
  );
}

/**
 * Comparisons section configuration
 */
function ComparisonsConfigForm({
  config,
  onUpdate,
  disabled,
}: {
  config: Record<string, unknown>;
  onUpdate: (updates: Record<string, unknown>) => void;
  disabled?: boolean;
}) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <TextField
        fullWidth
        size="small"
        label="Compare With Run ID"
        value={(config.compareWithRunId as string) || ''}
        onChange={(e) => onUpdate({ compareWithRunId: e.target.value })}
        disabled={disabled}
        placeholder="Enter test run ID or leave empty for baseline"
      />
      <FormControl fullWidth size="small">
        <InputLabel>Comparison View</InputLabel>
        <Select
          value={(config.view as string) || 'sideBySide'}
          onChange={(e) => onUpdate({ view: e.target.value })}
          label="Comparison View"
          disabled={disabled}
        >
          <MenuItem value="sideBySide">Side by Side</MenuItem>
          <MenuItem value="overlay">Overlay</MenuItem>
          <MenuItem value="diff">Difference Only</MenuItem>
        </Select>
      </FormControl>
      <FormControlLabel
        control={
          <Switch
            checked={(config.highlightDifferences as boolean) ?? true}
            onChange={(e) => onUpdate({ highlightDifferences: e.target.checked })}
            disabled={disabled}
            size="small"
          />
        }
        label="Highlight significant differences"
      />
    </Box>
  );
}

/**
 * Graphs section configuration
 */
function GraphsConfigForm({
  config,
  onUpdate,
  disabled,
}: {
  config: Record<string, unknown>;
  onUpdate: (updates: Record<string, unknown>) => void;
  disabled?: boolean;
}) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <FormControl fullWidth size="small">
        <InputLabel>Graph Type</InputLabel>
        <Select
          value={(config.graphType as string) || 'line'}
          onChange={(e) => onUpdate({ graphType: e.target.value })}
          label="Graph Type"
          disabled={disabled}
        >
          <MenuItem value="line">Line Chart</MenuItem>
          <MenuItem value="bar">Bar Chart</MenuItem>
          <MenuItem value="area">Area Chart</MenuItem>
          <MenuItem value="scatter">Scatter Plot</MenuItem>
          <MenuItem value="heatmap">Heatmap</MenuItem>
        </Select>
      </FormControl>
      <TextField
        fullWidth
        size="small"
        label="Metric Query"
        value={(config.metricQuery as string) || ''}
        onChange={(e) => onUpdate({ metricQuery: e.target.value })}
        disabled={disabled}
        placeholder="e.g., response_time{endpoint='/api/*'}"
        helperText="Query to select metrics to graph"
      />
      <TextField
        fullWidth
        size="small"
        label="Graph Title"
        value={(config.graphTitle as string) || ''}
        onChange={(e) => onUpdate({ graphTitle: e.target.value })}
        disabled={disabled}
        placeholder="Custom graph title"
      />
      <FormControlLabel
        control={
          <Switch
            checked={(config.showLegend as boolean) ?? true}
            onChange={(e) => onUpdate({ showLegend: e.target.checked })}
            disabled={disabled}
            size="small"
          />
        }
        label="Show legend"
      />
    </Box>
  );
}

/**
 * Get the configuration form for a section type
 */
function getConfigForm(
  type: ReportSectionType,
  config: Record<string, unknown>,
  onUpdate: (updates: Record<string, unknown>) => void,
  disabled?: boolean
): React.ReactNode {
  switch (type) {
    case 'header':
      return <HeaderConfigForm config={config} onUpdate={onUpdate} disabled={disabled} />;
    case 'text_block':
      return <TextBlockConfigForm config={config} onUpdate={onUpdate} disabled={disabled} />;
    case 'slo':
      return <SloConfigForm config={config} onUpdate={onUpdate} disabled={disabled} />;
    case 'apdex':
      return <ApdexConfigForm config={config} onUpdate={onUpdate} disabled={disabled} />;
    case 'transaction_response_times':
      return <TransactionResponseTimesConfigForm config={config} onUpdate={onUpdate} disabled={disabled} />;
    case 'regressions':
      return <RegressionsConfigForm config={config} onUpdate={onUpdate} disabled={disabled} />;
    case 'awr':
      return <AwrConfigForm config={config} onUpdate={onUpdate} disabled={disabled} />;
    case 'trends':
      return <TrendsConfigForm config={config} onUpdate={onUpdate} disabled={disabled} />;
    case 'comparisons':
      return <ComparisonsConfigForm config={config} onUpdate={onUpdate} disabled={disabled} />;
    case 'graphs':
      return <GraphsConfigForm config={config} onUpdate={onUpdate} disabled={disabled} />;
    default:
      return null;
  }
}

// ==================== Section Item Component ====================

/**
 * Individual section item with configuration
 */
function SectionItem({
  section,
  index,
  totalSections,
  onUpdate,
  onMoveUp,
  onMoveDown,
  onRemove,
  disabled,
  showDragHandle,
  compact,
}: SectionItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);

  const color = SECTION_COLORS[section.type];
  const supportsComments = isCommentableSection(section.type);

  const handleConfigUpdate = useCallback(
    (updates: Record<string, unknown>) => {
      onUpdate(index, { config: { ...section.config, ...updates } });
    },
    [index, section.config, onUpdate]
  );

  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onUpdate(index, { title: e.target.value });
    },
    [index, onUpdate]
  );

  const handleCommentChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onUpdate(index, { comment: e.target.value });
    },
    [index, onUpdate]
  );

  return (
    <Paper
      variant="outlined"
      sx={{
        border: '1px solid',
        borderColor: isExpanded ? color : 'divider',
        borderRadius: '8px',
        overflow: 'hidden',
        transition: 'all 0.2s ease',
        '&:hover': {
          borderColor: alpha(color, 0.5),
        },
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          p: compact ? 1 : 1.5,
          backgroundColor: isExpanded ? alpha(color, 0.05) : 'transparent',
        }}
      >
        {/* Drag handle */}
        {showDragHandle && (
          <Tooltip title="Drag to reorder">
            <IconButton
              size="small"
              sx={{
                cursor: 'grab',
                color: 'text.secondary',
                '&:active': { cursor: 'grabbing' },
              }}
              disabled={disabled}
            >
              <DragIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}

        {/* Order indicator */}
        <Box
          sx={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            backgroundColor: alpha(color, 0.15),
            color: color,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 600,
            fontSize: '0.8rem',
          }}
        >
          {index + 1}
        </Box>

        {/* Section icon */}
        <Box
          sx={{
            width: 28,
            height: 28,
            borderRadius: '6px',
            backgroundColor: alpha(color, 0.12),
            color: color,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {getSectionIcon(section.type)}
        </Box>

        {/* Title */}
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          {isEditingTitle ? (
            <TextField
              size="small"
              value={section.title || ''}
              onChange={handleTitleChange}
              onBlur={() => setIsEditingTitle(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === 'Escape') {
                  setIsEditingTitle(false);
                }
              }}
              disabled={disabled}
              autoFocus
              placeholder={getSectionTypeLabel(section.type)}
              sx={{
                flex: 1,
                '& .MuiInputBase-input': {
                  py: 0.5,
                  fontSize: '0.875rem',
                },
              }}
            />
          ) : (
            <>
              <Typography
                variant="body2"
                sx={{
                  fontWeight: 600,
                  color: 'text.primary',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {section.title || getSectionTypeLabel(section.type)}
              </Typography>
              <Tooltip title="Edit title">
                <IconButton
                  size="small"
                  onClick={() => setIsEditingTitle(true)}
                  disabled={disabled}
                  sx={{ opacity: 0.6, '&:hover': { opacity: 1 } }}
                >
                  <EditIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
            </>
          )}

          {/* Type chip */}
          <Chip
            label={getSectionTypeLabel(section.type)}
            size="small"
            sx={{
              height: 20,
              fontSize: '0.65rem',
              backgroundColor: alpha(color, 0.12),
              color: color,
              flexShrink: 0,
            }}
          />

          {/* Comment indicator */}
          {supportsComments && section.comment && (
            <Tooltip title="Has comment">
              <CommentIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
            </Tooltip>
          )}
        </Box>

        {/* Actions */}
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <Tooltip title="Move up">
            <span>
              <IconButton
                size="small"
                onClick={() => onMoveUp(index)}
                disabled={disabled || index === 0}
              >
                <ArrowUpIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Move down">
            <span>
              <IconButton
                size="small"
                onClick={() => onMoveDown(index)}
                disabled={disabled || index === totalSections - 1}
              >
                <ArrowDownIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Configure section">
            <IconButton
              size="small"
              onClick={() => setIsExpanded(!isExpanded)}
              sx={{ color: isExpanded ? color : 'action.active' }}
            >
              {isExpanded ? (
                <ExpandLessIcon fontSize="small" />
              ) : (
                <SettingsIcon fontSize="small" />
              )}
            </IconButton>
          </Tooltip>
          <Tooltip title="Remove section">
            <IconButton
              size="small"
              color="error"
              onClick={() => onRemove(index)}
              disabled={disabled}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Expanded configuration */}
      <Collapse in={isExpanded}>
        <Divider />
        <Box sx={{ p: 2 }}>
          {/* Section-specific configuration */}
          <Typography
            variant="subtitle2"
            sx={{ mb: 2, color: 'text.secondary', fontSize: '0.75rem' }}
          >
            Configuration
          </Typography>
          {getConfigForm(section.type, section.config || {}, handleConfigUpdate, disabled)}

          {/* Comment field for data sections */}
          {supportsComments && (
            <>
              <Divider sx={{ my: 2 }} />
              <Typography
                variant="subtitle2"
                sx={{ mb: 1, color: 'text.secondary', fontSize: '0.75rem' }}
              >
                Section Comment (Optional)
              </Typography>
              <TextField
                fullWidth
                size="small"
                multiline
                rows={2}
                value={section.comment || ''}
                onChange={handleCommentChange}
                disabled={disabled}
                placeholder="Add a comment to explain or highlight key points..."
                helperText={`${(section.comment || '').length}/${REPORT_LIMITS.MAX_COMMENT_LENGTH} characters`}
                inputProps={{ maxLength: REPORT_LIMITS.MAX_COMMENT_LENGTH }}
              />
            </>
          )}
        </Box>
      </Collapse>
    </Paper>
  );
}

// ==================== Main Component ====================

/**
 * SectionConfigurator - Main component for configuring report sections
 */
export function SectionConfigurator({
  sections,
  onSectionsChange,
  disabled = false,
  showDragHandles = true,
  compact = false,
}: SectionConfiguratorProps) {
  // Update a section at a specific index
  const handleUpdateSection = useCallback(
    (index: number, updates: Partial<ReportSectionConfig>) => {
      const newSections = [...sections];
      newSections[index] = { ...newSections[index], ...updates };
      onSectionsChange(newSections);
    },
    [sections, onSectionsChange]
  );

  // Move section up
  const handleMoveUp = useCallback(
    (index: number) => {
      if (index === 0) return;
      const newSections = [...sections];
      [newSections[index - 1], newSections[index]] = [
        newSections[index],
        newSections[index - 1],
      ];
      // Update order values
      onSectionsChange(newSections.map((s, i) => ({ ...s, order: i })));
    },
    [sections, onSectionsChange]
  );

  // Move section down
  const handleMoveDown = useCallback(
    (index: number) => {
      if (index === sections.length - 1) return;
      const newSections = [...sections];
      [newSections[index], newSections[index + 1]] = [
        newSections[index + 1],
        newSections[index],
      ];
      // Update order values
      onSectionsChange(newSections.map((s, i) => ({ ...s, order: i })));
    },
    [sections, onSectionsChange]
  );

  // Remove a section
  const handleRemoveSection = useCallback(
    (index: number) => {
      const newSections = sections.filter((_, i) => i !== index);
      // Update order values
      onSectionsChange(newSections.map((s, i) => ({ ...s, order: i })));
    },
    [sections, onSectionsChange]
  );

  // Empty state
  if (sections.length === 0) {
    return (
      <Alert severity="info" sx={{ mb: 2 }}>
        No sections added yet. Use the section palette above to add sections to your report.
      </Alert>
    );
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: compact ? 1 : 1.5,
      }}
    >
      {sections.map((section, index) => (
        <SectionItem
          key={`${section.type}-${index}`}
          section={section}
          index={index}
          totalSections={sections.length}
          onUpdate={handleUpdateSection}
          onMoveUp={handleMoveUp}
          onMoveDown={handleMoveDown}
          onRemove={handleRemoveSection}
          disabled={disabled}
          showDragHandle={showDragHandles}
          compact={compact}
        />
      ))}
    </Box>
  );
}

export default SectionConfigurator;
