'use client';

import { useState } from 'react';
import {
  Box,
  Typography,
  Chip,
  CircularProgress,
  Tooltip,
  IconButton,
  LinearProgress,
  TextField,
  useTheme,
} from '@mui/material';
import { HourglassEmpty, Launch, ContentCopy, Check, Edit, Save, Cancel } from '@mui/icons-material';
import { TestRun } from '@/types/test-runs';
import { authenticatedFetch } from '@/lib/api';
import { calculateProgress } from '@/app/test-runs/utils/test-run-utils';

interface TestRunIdentitySectionProps {
  testRun: TestRun;
  /** Lets the card show the new version without refetching the run. */
  onTestRunUpdate?: (updatedTestRun: TestRun) => void;
  showToast?: (message: string) => void;
}

export function TestRunIdentitySection({ testRun, onTestRunUpdate, showToast }: TestRunIdentitySectionProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const [copied, setCopied] = useState(false);

  // The version is often wrong on the run itself — a pipeline passes the wrong variable, or
  // the build is retagged after the test — so it is editable here rather than only at ingest.
  const [editingVersion, setEditingVersion] = useState(false);
  const [versionDraft, setVersionDraft] = useState('');
  const [versionSaving, setVersionSaving] = useState(false);

  const startVersionEdit = () => {
    setVersionDraft(testRun.application_release || '');
    setEditingVersion(true);
  };

  const saveVersion = async () => {
    const applicationRelease = versionDraft.trim();
    if (applicationRelease === (testRun.application_release || '')) {
      setEditingVersion(false);
      return;
    }
    setVersionSaving(true);
    try {
      const response = await authenticatedFetch(`/test-runs/${testRun.id}/application-release`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationRelease }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      onTestRunUpdate?.({ ...testRun, application_release: applicationRelease });
      setEditingVersion(false);
      showToast?.('Version updated successfully');
    } catch (error) {
      console.error('Failed to update version:', error);
      showToast?.('Failed to update version');
    } finally {
      setVersionSaving(false);
    }
  };

  const handleCopyTestRunId = () => {
    navigator.clipboard.writeText(testRun.test_run_id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Box sx={{
      p: 3,
      backgroundColor: isDark ? 'rgba(25, 118, 210, 0.04)' : 'rgba(255, 255, 255, 0.7)',
      backdropFilter: 'blur(10px)',
      border: isDark ? '1px solid rgba(25, 118, 210, 0.15)' : '1px solid rgba(25, 118, 210, 0.08)',
      borderRadius: 3,
      borderLeft: '4px solid',
      borderLeftColor: isDark ? '#64b5f6' : 'primary.main',
      boxShadow: isDark ? '0 2px 8px rgba(0, 0, 0, 0.2)' : '0 2px 8px rgba(0, 0, 0, 0.04)',
      transition: 'all 0.2s ease',
      '&:hover': {
        boxShadow: isDark ? '0 4px 12px rgba(0, 0, 0, 0.3)' : '0 4px 12px rgba(0, 0, 0, 0.08)',
        borderLeftColor: isDark ? '#90caf9' : 'primary.dark',
      }
    }}>
      <Typography
        variant="overline"
        sx={{
          display: 'block',
          fontSize: '0.875rem',
          fontWeight: 700,
          letterSpacing: '0.5px',
          color: 'primary.main',
          mb: 2.5,
        }}
      >
        Test Run Identity
      </Typography>

      {/* Test Run ID */}
      <Box sx={{ mb: 2.5 }}>
        <Typography
          variant="caption"
          sx={{
            display: 'block',
            fontSize: '0.75rem',
            fontWeight: 500,
            letterSpacing: '0.5px',
            textTransform: 'uppercase',
            color: 'text.secondary',
            mb: 0.75,
            opacity: 0.8,
          }}
        >
          Test Run ID
        </Typography>
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
          <Typography
            variant="body2"
            sx={{
              fontFamily: '"SF Mono", "Monaco", "Cascadia Code", "Roboto Mono", monospace',
              fontSize: '0.875rem',
              fontWeight: 500,
              backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.03)',
              px: 1.5,
              py: 0.75,
              borderRadius: 1,
              border: isDark ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid rgba(0, 0, 0, 0.06)',
              display: 'inline-block',
              color: 'text.primary',
            }}
          >
            {testRun.test_run_id}
          </Typography>
          <Tooltip title={copied ? 'Copied!' : 'Copy test run ID'}>
            <IconButton size="small" onClick={handleCopyTestRunId} sx={{ opacity: 0.5, '&:hover': { opacity: 1 } }}>
              {copied ? <Check sx={{ fontSize: 16 }} /> : <ContentCopy sx={{ fontSize: 16 }} />}
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Version */}
      <Box sx={{ mb: 2.5 }}>
        <Typography
          variant="caption"
          sx={{
            display: 'block',
            fontSize: '0.75rem',
            fontWeight: 500,
            letterSpacing: '0.5px',
            textTransform: 'uppercase',
            color: 'text.secondary',
            mb: 0.75,
            opacity: 0.8,
          }}
        >
          Version
        </Typography>
        {editingVersion ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <TextField
              value={versionDraft}
              onChange={(e) => setVersionDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveVersion();
                if (e.key === 'Escape') setEditingVersion(false);
              }}
              size="small"
              autoFocus
              placeholder="e.g. 2.4.3"
              inputProps={{ maxLength: 255 }}
              sx={{ flex: 1 }}
            />
            <Tooltip title="Save version">
              <span>
                <IconButton size="small" aria-label="Save version" onClick={saveVersion} disabled={versionSaving}>
                  {versionSaving ? <CircularProgress size={14} /> : <Save sx={{ fontSize: '1rem' }} />}
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Cancel">
              <span>
                <IconButton size="small" aria-label="Cancel version edit" onClick={() => setEditingVersion(false)} disabled={versionSaving}>
                  <Cancel sx={{ fontSize: '1rem' }} />
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography
              variant="body2"
              sx={{
                fontSize: '0.9375rem',
                fontWeight: 600,
                color: 'text.primary',
                lineHeight: 1.4,
              }}
            >
              {testRun.application_release || (
                <span style={{ fontStyle: 'italic', opacity: 0.5 }}>Not specified</span>
              )}
            </Typography>
            <Tooltip title="Edit version">
              <IconButton size="small" aria-label="Edit version" onClick={startVersionEdit} sx={{ opacity: 0.6, '&:hover': { opacity: 1 } }}>
                <Edit sx={{ fontSize: '0.9rem' }} />
              </IconButton>
            </Tooltip>
          </Box>
        )}
      </Box>

      {/* Status */}
      <Box sx={{ mb: testRun.ci_build_results_url ? 2.5 : 0 }}>
        <Typography
          variant="caption"
          sx={{
            display: 'block',
            fontSize: '0.75rem',
            fontWeight: 500,
            letterSpacing: '0.5px',
            textTransform: 'uppercase',
            color: 'text.secondary',
            mb: 0.75,
            opacity: 0.8,
          }}
        >
          Test Status
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            {testRun.abort ? (
              <Chip
                label="Aborted"
                size="medium"
                sx={{
                  height: '32px',
                  backgroundColor: 'rgba(244, 67, 54, 0.08)',
                  border: '1px solid rgba(244, 67, 54, 0.3)',
                  color: '#f44336',
                  fontWeight: 600,
                  fontSize: '0.875rem',
                  '& .MuiChip-label': {
                    px: 1.5,
                  },
                }}
              />
            ) : (
              <Chip
                label={testRun.completed ? 'Completed' : 'Running'}
                size="medium"
                icon={testRun.completed ? undefined : <CircularProgress size={14} sx={{ ml: 1 }} />}
                sx={{
                  height: '32px',
                  backgroundColor: testRun.completed ? 'rgba(76, 175, 80, 0.08)' : 'rgba(25, 118, 210, 0.08)',
                  border: testRun.completed ? '1px solid rgba(76, 175, 80, 0.3)' : '1px solid rgba(25, 118, 210, 0.3)',
                  color: testRun.completed ? '#4caf50' : 'primary.main',
                  fontWeight: 600,
                  fontSize: '0.875rem',
                  '& .MuiChip-label': {
                    px: 1.5,
                  },
                  '& .MuiChip-icon': {
                    ml: 1,
                  }
                }}
              />
            )}

            {/* Stale Indicator */}
            {testRun.is_stale && (
              <Tooltip
                title={`Test run became stale at ${testRun.stale_detected_at ? new Date(testRun.stale_detected_at).toLocaleString() : 'unknown time'}`}
                arrow
                placement="top"
              >
                <Chip
                  label="Stale"
                  size="medium"
                  icon={<HourglassEmpty sx={{ fontSize: '1rem' }} />}
                  sx={{
                    height: '32px',
                    background: 'linear-gradient(135deg, rgba(255, 152, 0, 0.08) 0%, rgba(255, 167, 38, 0.12) 100%)',
                    border: '1px solid rgba(255, 152, 0, 0.4)',
                    color: '#ff9800',
                    fontWeight: 600,
                    fontSize: '0.875rem',
                    backdropFilter: 'blur(8px)',
                    cursor: 'help',
                    '& .MuiChip-label': {
                      px: 1.5,
                    },
                    '& .MuiChip-icon': {
                      ml: 1,
                      color: '#ff9800',
                    }
                  }}
                />
              </Tooltip>
            )}
          </Box>

          {/* Completion Percentage Progress Bar */}
          {!testRun.abort && (!testRun.completed || testRun.is_stale) && testRun.start_time && testRun.planned_duration && (
            <Box sx={{ width: '100%' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography
                  variant="caption"
                  sx={{
                    fontSize: '0.7rem',
                    fontWeight: 500,
                    color: 'text.secondary',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}
                >
                  Completion
                </Typography>
                <Typography
                  variant="caption"
                  sx={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: testRun.is_stale ? '#ff9800' : 'primary.main',
                  }}
                >
                  {Math.round(calculateProgress(testRun))}%
                </Typography>
              </Box>
              <LinearProgress
                variant="determinate"
                value={calculateProgress(testRun)}
                sx={{
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
                  '& .MuiLinearProgress-bar': {
                    borderRadius: 4,
                    background: testRun.is_stale
                      ? 'linear-gradient(90deg, #ff9800 0%, #ffb74d 100%)'
                      : 'linear-gradient(90deg, #1976d2 0%, #42a5f5 100%)',
                    boxShadow: testRun.is_stale
                      ? '0 2px 8px rgba(255, 152, 0, 0.3)'
                      : '0 2px 8px rgba(25, 118, 210, 0.3)',
                  }
                }}
              />
            </Box>
          )}
        </Box>
      </Box>

      {/* CI/CD Result Link */}
      {testRun.ci_build_results_url && (
        <Box>
          <Typography
            variant="caption"
            sx={{
              display: 'block',
              fontSize: '0.75rem',
              fontWeight: 500,
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
              color: 'text.secondary',
              mb: 0.75,
              opacity: 0.8,
            }}
          >
            CI/CD Result
          </Typography>
          <Box
            component="a"
            href={testRun.ci_build_results_url}
            target="_blank"
            rel="noopener noreferrer"
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.5,
              textDecoration: 'none',
              color: 'primary.main',
              fontSize: '0.875rem',
              fontWeight: 600,
              padding: '6px 12px',
              borderRadius: 1,
              backgroundColor: 'rgba(25, 118, 210, 0.04)',
              border: '1px solid rgba(25, 118, 210, 0.2)',
              transition: 'all 0.2s ease',
              '&:hover': {
                backgroundColor: 'rgba(25, 118, 210, 0.08)',
                borderColor: 'rgba(25, 118, 210, 0.4)',
              }
            }}
          >
            View Build Results
            <Launch sx={{ fontSize: '1rem' }} />
          </Box>
        </Box>
      )}
    </Box>
  );
}
