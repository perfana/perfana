'use client';

import { useState } from 'react';
import { Box, Typography, Divider, IconButton, TextField, CircularProgress, Tooltip, useTheme } from '@mui/material';
import { Edit, Save, Cancel } from '@mui/icons-material';
import { TestRun } from '@/types/test-runs';
import { authenticatedFetch } from '@/lib/api';
import { formatDuration } from '../utils/test-run-formatters';

interface TimingInformationSectionProps {
  testRun: TestRun;
  onTestRunUpdate?: (updatedTestRun: TestRun) => void;
  showToast?: (message: string) => void;
}

export function TimingInformationSection({ testRun, onTestRunUpdate, showToast }: TimingInformationSectionProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const [isEditingRampUp, setIsEditingRampUp] = useState(false);
  const [editingRampUp, setEditingRampUp] = useState<string>('');
  const [rampUpSaving, setRampUpSaving] = useState(false);

  const handleRampUpEdit = () => {
    setEditingRampUp(String(testRun.ramp_up ?? 0));
    setIsEditingRampUp(true);
  };

  const handleRampUpCancel = () => {
    setIsEditingRampUp(false);
    setEditingRampUp('');
  };

  const handleRampUpSave = async () => {
    const rampUpValue = parseInt(editingRampUp, 10);
    if (isNaN(rampUpValue) || rampUpValue < 0) {
      showToast?.('Ramp-up must be a non-negative number (seconds)');
      return;
    }

    setRampUpSaving(true);
    try {
      const response = await authenticatedFetch(`/test-runs/${testRun.id}/ramp-up`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rampUp: rampUpValue }),
      });

      if (!response.ok) {
        throw new Error('Failed to update ramp-up');
      }

      const updatedTestRun = { ...testRun, ramp_up: rampUpValue };
      onTestRunUpdate?.(updatedTestRun);
      setIsEditingRampUp(false);
      showToast?.('Ramp-up updated successfully');
    } catch (error) {
      console.error('Failed to update ramp-up:', error);
      showToast?.('Failed to update ramp-up');
    } finally {
      setRampUpSaving(false);
    }
  };

  // Check if ramp-up exceeds actual duration
  const rampUpExceedsDuration = testRun.ramp_up != null && testRun.duration != null && testRun.ramp_up > testRun.duration;

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
      <Typography
        variant="overline"
        sx={{
          display: 'block',
          fontSize: '0.875rem',
          fontWeight: 700,
          letterSpacing: '0.5px',
          color: '#4caf50',
          mb: 2.5,
        }}
      >
        Timing Information
      </Typography>

      {/* Duration */}
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
          Total Duration
        </Typography>
        <Box sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
        }}>
          <Typography
            variant="h6"
            sx={{
              fontSize: '1.5rem',
              fontWeight: 700,
              color: 'text.primary',
              lineHeight: 1,
              fontFamily: '"SF Mono", "Monaco", monospace',
            }}
          >
            {formatDuration(testRun.duration)}
          </Typography>
        </Box>
      </Box>

      {/* Ramp Up Period */}
      <Box sx={{ mb: 2.5 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.75 }}>
          <Typography
            variant="caption"
            sx={{
              display: 'block',
              fontSize: '0.75rem',
              fontWeight: 500,
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
              color: 'text.secondary',
              opacity: 0.8,
            }}
          >
            Ramp Up Period
          </Typography>
          {!isEditingRampUp ? (
            <Tooltip title="Edit ramp-up period">
              <IconButton size="small" onClick={handleRampUpEdit} sx={{ p: 0.25 }}>
                <Edit sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          ) : (
            <Box display="flex" gap={0.5}>
              <IconButton size="small" onClick={handleRampUpSave} disabled={rampUpSaving} sx={{ p: 0.25 }}>
                {rampUpSaving ? <CircularProgress size={16} /> : <Save sx={{ fontSize: 16 }} />}
              </IconButton>
              <IconButton size="small" onClick={handleRampUpCancel} disabled={rampUpSaving} sx={{ p: 0.25 }}>
                <Cancel sx={{ fontSize: 16 }} />
              </IconButton>
            </Box>
          )}
        </Box>
        {isEditingRampUp ? (
          <TextField
            value={editingRampUp}
            onChange={(e) => setEditingRampUp(e.target.value)}
            size="small"
            type="number"
            inputProps={{ min: 0 }}
            helperText="Duration in seconds"
            disabled={rampUpSaving}
            fullWidth
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRampUpSave();
              if (e.key === 'Escape') handleRampUpCancel();
            }}
            sx={{ mt: 0.5 }}
          />
        ) : (
          <>
            <Typography
              variant="body2"
              sx={{
                fontSize: '0.9375rem',
                fontWeight: 600,
                color: rampUpExceedsDuration ? 'warning.main' : 'text.primary',
                lineHeight: 1.4,
              }}
            >
              {formatDuration(testRun.ramp_up)}
            </Typography>
            {rampUpExceedsDuration && (
              <Typography
                variant="caption"
                sx={{ color: 'warning.main', display: 'block', mt: 0.5 }}
              >
                Ramp-up exceeds test duration — no steady-state data for analysis
              </Typography>
            )}
          </>
        )}
      </Box>

      <Divider sx={{ my: 2, opacity: 0.4 }} />

      {/* Start Time */}
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
          Start Time
        </Typography>
        <Typography
          variant="body2"
          sx={{
            fontSize: '0.9375rem',
            fontWeight: 600,
            color: 'text.primary',
            lineHeight: 1.4,
          }}
        >
          {testRun.start_time ? new Date(testRun.start_time).toLocaleString(undefined, {
            dateStyle: 'medium',
            timeStyle: 'medium'
          }) : (
            <span style={{ fontStyle: 'italic', opacity: 0.5 }}>Not available</span>
          )}
        </Typography>
      </Box>

      {/* End Time */}
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
          End Time
        </Typography>
        <Typography
          variant="body2"
          sx={{
            fontSize: '0.9375rem',
            fontWeight: 600,
            color: 'text.primary',
            lineHeight: 1.4,
          }}
        >
          {testRun.end_time ? new Date(testRun.end_time).toLocaleString(undefined, {
            dateStyle: 'medium',
            timeStyle: 'medium'
          }) : (
            <span style={{ fontStyle: 'italic', opacity: 0.5 }}>Not available</span>
          )}
        </Typography>
      </Box>
    </Box>
  );
}
