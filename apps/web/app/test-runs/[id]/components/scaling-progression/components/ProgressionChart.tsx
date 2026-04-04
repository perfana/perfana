'use client';

import { useState, useCallback } from 'react';
import {
  Box,
  Typography,
  Tooltip,
  Chip,
  TextField,
  IconButton,
  alpha,
  useTheme,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import EditIcon from '@mui/icons-material/Edit';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { ProgressionData, ProgressionRun, SloResult } from '../types';
import SoftBadge from '../../shared/SoftBadge';
import { authenticatedFetch } from '@/lib/api';

interface Props {
  data: ProgressionData;
  currentTestRunId: string;
  onRefresh: () => void;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function getSloSummaryChip(run: ProgressionRun) {
  const total = run.slo_results.length;
  if (total === 0) {
    if (!run.completed) return { label: 'In progress', color: 'default' as const };
    return { label: 'No SLOs', color: 'default' as const };
  }
  const passed = run.slo_results.filter(s => s.meets_requirement === true).length;
  const failed = run.slo_results.filter(s => s.meets_requirement === false).length;
  if (failed > 0) return { label: `${failed}/${total} failed`, color: 'error' as const };
  if (passed === total) return { label: `${passed}/${total} pass`, color: 'success' as const };
  return { label: `${passed}/${total}`, color: 'default' as const };
}

function formatSloRequirement(slo: SloResult): string {
  if (slo.benchmark_type === 'apdex') {
    return `Apdex >= ${slo.min_apdex_score} (T=${slo.apdex_threshold_ms}ms)`;
  }
  if (slo.requirement_operator && slo.requirement_value != null) {
    const unit = slo.metric_unit ? ` ${slo.metric_unit}` : '';
    return `${slo.requirement_operator} ${slo.requirement_value}${unit}`;
  }
  return '';
}

export function ProgressionChart({ data, currentTestRunId, onRefresh }: Props) {
  const theme = useTheme();
  const { session, runs } = data;
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [editingComment, setEditingComment] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState('');

  const selectedRun = runs.find(r => r.test_run_id === selectedRunId) || null;

  const handleSaveComment = useCallback(async (testRunId: string) => {
    try {
      await authenticatedFetch(`/scaling-sessions/${session.id}/runs/${testRunId}/comment`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: commentDraft }),
      });
      setEditingComment(null);
      onRefresh();
    } catch {
      // silent fail
    }
  }, [session.id, commentDraft, onRefresh]);

  const handleAnomalyChipClick = (run: ProgressionRun, conclusionFilter?: string) => {
    const isCurrentRun = run.test_run_id === currentTestRunId;
    if (isCurrentRun) {
      // Deeplink to anomaly detection card on this page with filter
      const section = document.querySelector('[data-testid="anomaly-detection-section-expanded"], [data-testid="anomaly-detection-section-collapsed"]');
      if (section) {
        section.scrollIntoView({ behavior: 'smooth', block: 'center' });
        (section as HTMLElement).click();
      }
    } else {
      // Open test run in new tab
      const url = `/test-runs/${run.test_run_id}${conclusionFilter ? `?anomalyFilter=${conclusionFilter}` : ''}`;
      window.open(url, '_blank');
    }
  };

  if (runs.length === 0) {
    return (
      <Box sx={{ py: 4, textAlign: 'center' }}>
        <Typography color="text.secondary">No test runs in this scaling session yet.</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Run List */}
      <Box>
        {/* Header */}
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: '2fr 120px 100px 1.5fr',
          gap: 1,
          px: 1.5,
          py: 1,
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}>
          <Typography variant="caption" fontWeight={600} color="text.secondary">Test Run</Typography>
          <Typography variant="caption" fontWeight={600} color="text.secondary">Date</Typography>
          <Typography variant="caption" fontWeight={600} color="text.secondary">SLOs</Typography>
          <Typography variant="caption" fontWeight={600} color="text.secondary">Comment</Typography>
        </Box>

        {/* Rows */}
        {runs.map((run) => {
          const isSelected = selectedRunId === run.test_run_id;
          const isCurrent = run.test_run_id === currentTestRunId;
          const sloSummary = getSloSummaryChip(run);
          const isEditing = editingComment === run.test_run_id;

          return (
            <Box
              key={run.test_run_id}
              onClick={() => setSelectedRunId(isSelected ? null : run.test_run_id)}
              sx={{
                display: 'grid',
                gridTemplateColumns: '2fr 120px 100px 1.5fr',
                gap: 1,
                px: 1.5,
                py: 1,
                cursor: 'pointer',
                borderLeft: isSelected ? '3px solid' : '3px solid transparent',
                borderLeftColor: isSelected ? 'primary.main' : 'transparent',
                bgcolor: isSelected
                  ? alpha(theme.palette.primary.main, 0.06)
                  : isCurrent
                    ? alpha(theme.palette.primary.main, 0.02)
                    : 'transparent',
                borderBottom: '1px solid',
                borderBottomColor: alpha(theme.palette.divider, 0.5),
                transition: 'all 0.15s ease',
                '&:hover': {
                  bgcolor: alpha(theme.palette.primary.main, 0.04),
                },
              }}
            >
              {/* Test Run ID with hover tooltip */}
              <Tooltip
                title={
                  <Box sx={{ p: 0.5 }}>
                    {run.application_release && (
                      <Typography variant="body2" sx={{ color: 'white' }}>
                        Version: {run.application_release}
                      </Typography>
                    )}
                    {run.annotations.length > 0 && (
                      <Typography variant="body2" sx={{ color: 'white', mt: 0.5 }}>
                        {run.annotations.join(', ')}
                      </Typography>
                    )}
                    {!run.application_release && run.annotations.length === 0 && (
                      <Typography variant="body2" sx={{ color: 'white' }}>
                        {run.test_run_id}
                      </Typography>
                    )}
                  </Box>
                }
                arrow
                placement="top"
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, overflow: 'hidden' }}>
                  <Typography
                    variant="body2"
                    fontWeight={isCurrent ? 600 : 400}
                    noWrap
                    sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
                  >
                    {run.test_run_id}
                  </Typography>
                  {isCurrent && (
                    <Chip label="current" size="small" color="primary" sx={{ height: 18, fontSize: '0.6rem', flexShrink: 0 }} />
                  )}
                </Box>
              </Tooltip>

              {/* Date */}
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8rem' }}>
                {formatDate(run.start_time)}
              </Typography>

              {/* SLO Summary */}
              <Box>
                <Chip
                  label={sloSummary.label}
                  size="small"
                  color={sloSummary.color}
                  variant="outlined"
                  sx={{ height: 22, fontSize: '0.7rem' }}
                />
              </Box>

              {/* Comment */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }} onClick={(e) => e.stopPropagation()}>
                {isEditing ? (
                  <>
                    <TextField
                      value={commentDraft}
                      onChange={(e) => setCommentDraft(e.target.value)}
                      size="small"
                      variant="standard"
                      autoFocus
                      sx={{ flex: 1, '& .MuiInput-input': { fontSize: '0.8rem', py: 0 } }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveComment(run.test_run_id);
                        if (e.key === 'Escape') setEditingComment(null);
                      }}
                    />
                    <IconButton size="small" onClick={() => handleSaveComment(run.test_run_id)} sx={{ p: 0.25 }}>
                      <CheckIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                    <IconButton size="small" onClick={() => setEditingComment(null)} sx={{ p: 0.25 }}>
                      <CloseIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </>
                ) : (
                  <>
                    <Typography
                      variant="body2"
                      color={run.comment ? 'text.primary' : 'text.disabled'}
                      noWrap
                      sx={{ flex: 1, fontSize: '0.8rem' }}
                    >
                      {run.comment || '—'}
                    </Typography>
                    <IconButton
                      size="small"
                      onClick={() => {
                        setEditingComment(run.test_run_id);
                        setCommentDraft(run.comment || '');
                      }}
                      sx={{ p: 0.25, opacity: 0.5, '&:hover': { opacity: 1 } }}
                    >
                      <EditIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  </>
                )}
              </Box>
            </Box>
          );
        })}
      </Box>

      {/* Selected Run Detail */}
      {selectedRun && (
        <Box sx={{
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
          p: 2,
          bgcolor: alpha(theme.palette.background.paper, 0.8),
        }}>
          {/* Anomaly Detection TLDR */}
          {Object.keys(selectedRun.anomaly_summary).length > 0 && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                Anomaly Detection
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                {Object.entries(selectedRun.anomaly_summary)
                  .filter(([label]) =>
                    label !== 'partial' &&
                    label !== 'incomparable' &&
                    label !== 'no difference'
                  )
                  .map(([label, count]) => {
                    const badgeColor = label === 'regression' ? 'red' as const
                      : label === 'improvement' ? 'green' as const
                      : 'blue' as const;
                    return (
                      <SoftBadge
                        key={label}
                        count={count}
                        label={label}
                        color={badgeColor}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAnomalyChipClick(selectedRun, label);
                        }}
                      />
                    );
                  })}
                {selectedRun.test_run_id !== currentTestRunId && (
                  <Tooltip title="Open full anomaly detection in new tab">
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(`/test-runs/${selectedRun.test_run_id}`, '_blank');
                      }}
                      sx={{ p: 0.5 }}
                    >
                      <OpenInNewIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                )}
              </Box>
            </Box>
          )}

          {/* SLO Results for Selected Run */}
          <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
            SLO Results — {selectedRun.test_run_id}
          </Typography>

          {selectedRun.slo_results.length > 0 ? (
            <Box>
              {/* SLO Table Header */}
              <Box sx={{
                display: 'grid',
                gridTemplateColumns: '2fr 2fr 1.5fr 80px',
                gap: 1,
                p: 1.5,
                bgcolor: theme.palette.mode === 'dark'
                  ? alpha(theme.palette.common.white, 0.04)
                  : 'action.hover',
                borderRadius: '4px 4px 0 0',
                border: '1px solid',
                borderColor: 'divider',
                borderBottom: 'none',
              }}>
                <Typography variant="caption" fontWeight={600}>Dashboard / SLO</Typography>
                <Typography variant="caption" fontWeight={600}>Metric</Typography>
                <Typography variant="caption" fontWeight={600}>Requirement</Typography>
                <Typography variant="caption" fontWeight={600} sx={{ textAlign: 'center' }}>Status</Typography>
              </Box>

              {/* SLO Rows */}
              {selectedRun.slo_results.map((slo) => (
                <Box
                  key={slo.benchmark_id}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: '2fr 2fr 1.5fr 80px',
                    gap: 1,
                    p: 1.5,
                    border: '1px solid',
                    borderColor: alpha(theme.palette.divider, 0.6),
                    borderTop: 'none',
                    '&:last-child': { borderRadius: '0 0 4px 4px' },
                  }}
                >
                  <Typography variant="body2" fontWeight={500}>
                    {slo.label}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {slo.benchmark_type === 'apdex'
                      ? `Apdex${slo.transaction_name ? `: ${slo.transaction_name}` : ''}`
                      : slo.actual_value != null
                        ? `${Number(slo.actual_value).toFixed(2)}${slo.metric_unit ? ` ${slo.metric_unit}` : ''}`
                        : 'N/A'}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8rem' }}>
                    {formatSloRequirement(slo)}
                  </Typography>
                  <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                    {slo.meets_requirement === true ? (
                      <Chip
                        label="Pass"
                        size="small"
                        sx={{
                          height: 24,
                          fontWeight: 700,
                          fontSize: '0.7rem',
                          background: `linear-gradient(135deg, ${alpha(theme.palette.success.main, 0.1)} 0%, ${alpha(theme.palette.success.main, 0.06)} 100%)`,
                          border: `1px solid ${alpha(theme.palette.success.main, 0.3)}`,
                          color: theme.palette.success.dark,
                        }}
                      />
                    ) : slo.meets_requirement === false ? (
                      <Chip
                        label="Fail"
                        size="small"
                        sx={{
                          height: 24,
                          fontWeight: 700,
                          fontSize: '0.7rem',
                          background: `linear-gradient(135deg, ${alpha(theme.palette.error.main, 0.1)} 0%, ${alpha(theme.palette.error.main, 0.06)} 100%)`,
                          border: `1px solid ${alpha(theme.palette.error.main, 0.3)}`,
                          color: theme.palette.error.main,
                        }}
                      />
                    ) : (
                      <Typography variant="body2" color="text.secondary">—</Typography>
                    )}
                  </Box>
                </Box>
              ))}
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
              {selectedRun.completed ? 'No SLO data for this run.' : 'Test run still in progress.'}
            </Typography>
          )}
        </Box>
      )}

      {!selectedRun && runs.length > 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
          Select a test run above to view SLO results and anomaly details.
        </Typography>
      )}
    </Box>
  );
}
