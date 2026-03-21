'use client';

import {
  Box,
  Typography,
  IconButton,
  Collapse,
  TextField,
  Button,
  CircularProgress,
  Alert,
  Tooltip,
} from '@mui/material';
import {
  ExpandMore,
  ExpandLess,
  Close,
  OpenInNew,
} from '@mui/icons-material';
import { FlamegraphAnalysis, FlamegraphDiff } from '../types';

interface PyroscopeAnalysisProps {
  analysis: FlamegraphAnalysis | null;
  loading: boolean;
  showAnalysis: boolean;
  onToggleAnalysis: () => void;
  symbolFilter: string;
  onSymbolFilterChange: (value: string) => void;
  showAllRegressions: boolean;
  onToggleAllRegressions: () => void;
  showAllImprovements: boolean;
  onToggleAllImprovements: () => void;
  compareViewUrl: string | null;
  isLoading: boolean;
  hasBaseline: boolean;
  onOpenExternal: () => void;
}

function FunctionChangeItem({
  change,
  isRegression,
}: {
  change: FlamegraphDiff;
  isRegression: boolean;
}) {
  const color = isRegression ? 'error' : 'success';
  const bgColor = isRegression ? 'rgba(211, 47, 47, 0.05)' : 'rgba(76, 175, 80, 0.05)';
  const hoverBgColor = isRegression ? 'rgba(211, 47, 47, 0.08)' : 'rgba(76, 175, 80, 0.08)';
  const badgeType = isRegression ? 'NEW' : 'REMOVED';
  const showBadge = isRegression ? change.changeType === 'new' : change.changeType === 'removed';

  return (
    <Box
      sx={{
        p: 1.5,
        '&:hover': {
          backgroundColor: hoverBgColor,
        },
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexGrow: 1 }}>
          {showBadge && (
            <Typography
              variant="caption"
              sx={{
                fontWeight: 600,
                px: 0.75,
                py: 0.25,
                borderRadius: 1,
                backgroundColor: `${color}.main`,
                color: 'white',
                fontSize: '0.65rem',
              }}
            >
              {badgeType}
            </Typography>
          )}
          <Tooltip title={change.function}>
            <Typography
              variant="body2"
              sx={{
                fontFamily: 'monospace',
                fontSize: '0.75rem',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flexGrow: 1,
              }}
            >
              {change.function}
            </Typography>
          </Tooltip>
        </Box>
      </Box>
      <Box sx={{ display: 'flex', gap: 2, fontSize: '0.75rem' }}>
        <Typography variant="caption">
          Baseline: {change.baselineSamples.toLocaleString()}
        </Typography>
        <Typography variant="caption">
          Current: {change.currentSamples.toLocaleString()}
        </Typography>
        <Typography
          variant="caption"
          sx={{
            color: `${color}.main`,
            fontWeight: 600,
          }}
        >
          {isRegression ? '+' : ''}{change.delta.toLocaleString()} ({isRegression ? '+' : ''}
          {change.deltaPercent.toFixed(1)}%)
        </Typography>
      </Box>
    </Box>
  );
}

function FunctionChangeList({
  changes,
  isRegression,
  showAll,
  onToggleShowAll,
}: {
  changes: FlamegraphDiff[];
  isRegression: boolean;
  showAll: boolean;
  onToggleShowAll: () => void;
}) {
  const color = isRegression ? 'error' : 'success';
  const displayedChanges = showAll ? changes : changes.slice(0, 5);

  return (
    <Box>
      <Typography
        variant="subtitle2"
        sx={{
          mb: 1,
          fontWeight: 600,
          color: `${color}.main`,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
        }}
      >
        {isRegression ? 'Top Increases' : 'Top Decreases'}
      </Typography>
      <Box
        sx={{
          border: '1px solid',
          borderColor: `${color}.light`,
          borderRadius: 2,
          backgroundColor: isRegression ? 'rgba(211, 47, 47, 0.05)' : 'rgba(76, 175, 80, 0.05)',
        }}
      >
        {displayedChanges.map((change, idx) => (
          <Box
            key={idx}
            sx={{
              borderBottom:
                idx < displayedChanges.length - 1 ? '1px solid' : 'none',
              borderColor: `${color}.light`,
            }}
          >
            <FunctionChangeItem change={change} isRegression={isRegression} />
          </Box>
        ))}
        {changes.length > 5 && (
          <Box
            sx={{
              p: 1.5,
              textAlign: 'center',
              borderTop: '1px solid',
              borderColor: `${color}.light`,
            }}
          >
            <Button
              size="small"
              onClick={onToggleShowAll}
              sx={{
                color: `${color}.main`,
                fontSize: '0.75rem',
                textTransform: 'none',
              }}
            >
              {showAll ? 'Show less' : `Show ${changes.length - 5} more...`}
            </Button>
          </Box>
        )}
      </Box>
    </Box>
  );
}

function SummaryStatBox({
  label,
  value,
  showSign = false,
}: {
  label: string;
  value: number | string;
  showSign?: boolean;
}) {
  const numValue = typeof value === 'number' ? value : 0;
  const color =
    showSign && numValue !== 0
      ? numValue > 0
        ? 'error.main'
        : 'success.main'
      : 'text.primary';

  const displayValue =
    typeof value === 'number'
      ? (showSign && value > 0 ? '+' : '') + value.toLocaleString()
      : value;

  return (
    <Box
      sx={{
        p: 2,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        textAlign: 'center',
      }}
    >
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h6" sx={{ fontFamily: 'monospace', color }}>
        {displayValue}
      </Typography>
    </Box>
  );
}

export function PyroscopeAnalysis({
  analysis,
  loading,
  showAnalysis,
  onToggleAnalysis,
  symbolFilter,
  onSymbolFilterChange,
  showAllRegressions,
  onToggleAllRegressions,
  showAllImprovements,
  onToggleAllImprovements,
  compareViewUrl,
  isLoading,
  hasBaseline,
  onOpenExternal,
}: PyroscopeAnalysisProps) {
  return (
    <Box sx={{ mb: 3 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          mb: 2,
        }}
      >
        <Typography variant="h6" sx={{ fontSize: '1rem', fontWeight: 600 }}>
          Flamegraph Analysis
        </Typography>
        <IconButton size="small" onClick={onToggleAnalysis} sx={{ ml: 1 }}>
          {showAnalysis ? <ExpandLess /> : <ExpandMore />}
        </IconButton>
      </Box>

      <Collapse in={showAnalysis}>
        {/* Symbol Filter and External Link Button */}
        <Box sx={{ mb: 3, display: 'flex', gap: 2, alignItems: 'flex-start' }}>
          <TextField
            size="small"
            label="Symbol Filter (Optional)"
            placeholder="Filter by symbol/function name (e.g., 'java.', 'com.example.')"
            value={symbolFilter}
            onChange={(e) => onSymbolFilterChange(e.target.value)}
            helperText="Filter functions by pattern"
            sx={{ flex: 1 }}
            InputProps={{
              endAdornment: symbolFilter && (
                <IconButton
                  size="small"
                  onClick={() => onSymbolFilterChange('')}
                  sx={{ mr: -1 }}
                >
                  <Close fontSize="small" />
                </IconButton>
              ),
            }}
          />
          <Button
            variant="outlined"
            startIcon={<OpenInNew />}
            onClick={onOpenExternal}
            disabled={!compareViewUrl || isLoading || !hasBaseline}
            sx={{ mt: 0.5, whiteSpace: 'nowrap' }}
          >
            Open in Pyroscope
          </Button>
        </Box>

        {loading ? (
          <Box textAlign="center" py={3}>
            <CircularProgress size={32} />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Analyzing flamegraphs...
            </Typography>
          </Box>
        ) : analysis?.error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {analysis.error}
          </Alert>
        ) : analysis ? (
          <Box>
            {/* Summary Statistics */}
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
                gap: 2,
                mb: 3,
              }}
            >
              <SummaryStatBox label="Baseline Total" value={analysis.summary.baselineTotal} />
              <SummaryStatBox label="Current Total" value={analysis.summary.currentTotal} />
              <SummaryStatBox label="Delta" value={analysis.summary.totalDelta} showSign />
              <SummaryStatBox
                label="% Change"
                value={`${analysis.summary.totalDeltaPercent > 0 ? '+' : ''}${analysis.summary.totalDeltaPercent.toFixed(1)}%`}
              />
            </Box>

            {(analysis.regressions && analysis.regressions.length > 0) ||
            (analysis.improvements && analysis.improvements.length > 0) ||
            analysis.topFunctionChanges.length > 0 ? (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' },
                  gap: 3,
                }}
              >
                {/* Regressions */}
                {analysis.regressions && analysis.regressions.length > 0 && (
                  <FunctionChangeList
                    changes={analysis.regressions}
                    isRegression
                    showAll={showAllRegressions}
                    onToggleShowAll={onToggleAllRegressions}
                  />
                )}

                {/* Improvements */}
                {analysis.improvements && analysis.improvements.length > 0 && (
                  <FunctionChangeList
                    changes={analysis.improvements}
                    isRegression={false}
                    showAll={showAllImprovements}
                    onToggleShowAll={onToggleAllImprovements}
                  />
                )}
              </Box>
            ) : null}
          </Box>
        ) : null}
      </Collapse>
    </Box>
  );
}
