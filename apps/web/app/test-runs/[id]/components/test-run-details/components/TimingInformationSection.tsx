'use client';

import { useState, useEffect } from 'react';
import { Box, Typography, Divider, Button, CircularProgress, useTheme } from '@mui/material';
import { Timeline } from '@mui/icons-material';
import { TestRun } from '@/types/test-runs';
import { authenticatedFetch } from '@/lib/api';
import { formatDuration } from '../utils/test-run-formatters';
import { AnalysisTimeRangeDialog } from './AnalysisTimeRangeDialog';

interface SummaryTimeseriesResponse {
  duration: number;
  bucketSizeSeconds: number;
  buckets: { timeSeconds: number; throughput: number; avgResponseTime: number; errorsPerSecond: number }[];
}

interface TimingInformationSectionProps {
  testRun: TestRun;
  onTestRunUpdate?: (updatedTestRun: TestRun) => void;
  showToast?: (message: string) => void;
}

export function TimingInformationSection({ testRun, onTestRunUpdate, showToast }: TimingInformationSectionProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const [timeseriesData, setTimeseriesData] = useState<SummaryTimeseriesResponse | null>(null);
  const [timeseriesLoading, setTimeseriesLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (!testRun.completed) return;
    setTimeseriesLoading(true);
    authenticatedFetch(`/test-runs/${testRun.id}/summary-timeseries`)
      .then(res => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data: SummaryTimeseriesResponse | null) => setTimeseriesData(data))
      .catch(() => setTimeseriesData(null))
      .finally(() => setTimeseriesLoading(false));
  }, [testRun.id, testRun.completed]);

  const startOffset = testRun.analysis_start_offset ?? 0;
  const endOffset   = testRun.analysis_end_offset ?? 0;
  const duration    = testRun.duration ?? 0;
  const effectiveEnd = duration - endOffset;
  const effectiveDuration = effectiveEnd - startOffset;

  const showButton = testRun.completed && !timeseriesLoading && timeseriesData !== null;

  return (
    <Box sx={{
      p: 3,
      backgroundColor: isDark ? 'rgba(76, 175, 80, 0.04)' : 'rgba(255, 255, 255, 0.7)',
      backdropFilter: 'blur(10px)',
      border: isDark ? '1px solid rgba(76, 175, 80, 0.15)' : '1px solid rgba(76, 175, 80, 0.08)',
      borderRadius: 3,
      borderLeft: '4px solid',
      borderLeftColor: isDark ? '#81c784' : '#4caf50',
      boxShadow: isDark ? '0 2px 8px rgba(0, 0, 0, 0.2)' : '0 2px 8px rgba(0, 0, 0, 0.04)',
      transition: 'all 0.2s ease',
      '&:hover': {
        boxShadow: isDark ? '0 4px 12px rgba(0, 0, 0, 0.3)' : '0 4px 12px rgba(0, 0, 0, 0.08)',
        borderLeftColor: isDark ? '#a5d6a7' : '#388e3c',
      }
    }}>
      <Typography variant="overline" sx={{ display: 'block', fontSize: '0.875rem', fontWeight: 700, letterSpacing: '0.5px', color: '#4caf50', mb: 2.5 }}>
        Timing Information
      </Typography>

      {/* Total Duration */}
      <Box sx={{ mb: 2.5 }}>
        <Typography variant="caption" sx={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'text.secondary', mb: 0.75, opacity: 0.8 }}>
          Total Duration
        </Typography>
        <Typography variant="h6" sx={{ fontSize: '1.5rem', fontWeight: 700, color: 'text.primary', lineHeight: 1, fontFamily: '"SF Mono", "Monaco", monospace' }}>
          {formatDuration(testRun.duration)}
        </Typography>
      </Box>

      {/* Analysis Window */}
      <Box sx={{ mb: 2.5 }}>
        <Typography variant="caption" sx={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'text.secondary', mb: 0.75, opacity: 0.8 }}>
          Analysis Window
        </Typography>
        <Typography variant="body2" sx={{ fontSize: '0.9375rem', fontWeight: 600, color: 'text.primary', lineHeight: 1.4 }}>
          {formatDuration(startOffset)} → {formatDuration(effectiveEnd)}
          <Typography component="span" variant="caption" sx={{ ml: 1, color: 'text.secondary', fontWeight: 400 }}>
            ({formatDuration(Math.max(0, effectiveDuration))} effective)
          </Typography>
        </Typography>
        <Box sx={{ mt: 0.75 }}>
          {timeseriesLoading ? (
            <CircularProgress size={14} sx={{ mt: 0.25 }} />
          ) : showButton ? (
            <Button
              size="small"
              variant="outlined"
              startIcon={<Timeline sx={{ fontSize: 14 }} />}
              onClick={() => setDialogOpen(true)}
              sx={{ fontSize: '0.75rem', py: 0.25, px: 1, borderRadius: 1.5, borderColor: 'primary.main', color: 'primary.main', textTransform: 'none' }}
            >
              Change analysis time range
            </Button>
          ) : null}
        </Box>
      </Box>

      <Divider sx={{ my: 2, opacity: 0.4 }} />

      {/* Start Time */}
      <Box sx={{ mb: 2.5 }}>
        <Typography variant="caption" sx={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'text.secondary', mb: 0.75, opacity: 0.8 }}>
          Start Time
        </Typography>
        <Typography variant="body2" sx={{ fontSize: '0.9375rem', fontWeight: 600, color: 'text.primary', lineHeight: 1.4 }}>
          {testRun.start_time ? new Date(testRun.start_time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' }) : <span style={{ fontStyle: 'italic', opacity: 0.5 }}>Not available</span>}
        </Typography>
      </Box>

      {/* End Time */}
      <Box>
        <Typography variant="caption" sx={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'text.secondary', mb: 0.75, opacity: 0.8 }}>
          End Time
        </Typography>
        <Typography variant="body2" sx={{ fontSize: '0.9375rem', fontWeight: 600, color: 'text.primary', lineHeight: 1.4 }}>
          {testRun.end_time ? new Date(testRun.end_time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' }) : <span style={{ fontStyle: 'italic', opacity: 0.5 }}>Not available</span>}
        </Typography>
      </Box>

      {dialogOpen && timeseriesData && (
        <AnalysisTimeRangeDialog
          open={dialogOpen}
          testRun={testRun}
          timeseriesData={timeseriesData}
          onClose={() => setDialogOpen(false)}
          onSaved={(updated) => {
            onTestRunUpdate?.(updated);
            setDialogOpen(false);
            showToast?.('Analysis time range updated — re-analysis enqueued');
          }}
        />
      )}
    </Box>
  );
}
