'use client';

import React from 'react';
import { Box, Typography, Card, CardContent, Chip } from '@mui/material';
import {
  TrendingUp as TrendingUpIcon,
  TrendingDown as TrendingDownIcon,
} from '@mui/icons-material';
import { BaselineWorkloadSummary, getApdexColor } from '../types';

interface WorkloadSummaryCardProps {
  summary: BaselineWorkloadSummary;
}

export function WorkloadSummaryCard({ summary }: WorkloadSummaryCardProps) {
  const showTrendIcon =
    summary.projected_workload_apdex !== null &&
    summary.current_workload_apdex !== null;

  const isImprovement =
    showTrendIcon &&
    summary.projected_workload_apdex! > summary.current_workload_apdex!;

  return (
    <Card sx={{ mb: 3, bgcolor: 'rgba(25, 118, 210, 0.05)' }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Workload Summary
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          <Box sx={{ minWidth: 150 }}>
            <Typography variant="body2" color="text.secondary">
              Current Threshold
            </Typography>
            <Typography variant="body2" fontWeight={600}>
              {summary.current_workload_threshold}ms
            </Typography>
          </Box>
          <Box sx={{ minWidth: 150 }}>
            <Typography variant="body2" color="text.secondary">
              Calculated Threshold
            </Typography>
            <Typography variant="body2" fontWeight={600} color="primary">
              {summary.calculated_workload_threshold}ms
            </Typography>
          </Box>
          <Box sx={{ minWidth: 150 }}>
            <Typography variant="body2" color="text.secondary">
              Achievable Transactions
            </Typography>
            <Typography variant="body2">
              {summary.achievable_count} of {summary.total_transactions}
            </Typography>
          </Box>
          <Box sx={{ minWidth: 120 }}>
            <Typography variant="body2" color="text.secondary">
              Current Apdex
            </Typography>
            <Chip
              label={summary.current_workload_apdex?.toFixed(3) ?? 'N/A'}
              size="small"
              sx={{
                backgroundColor: getApdexColor(summary.current_workload_apdex),
                color: '#fff',
                mt: 0.5,
              }}
            />
          </Box>
          <Box sx={{ minWidth: 120 }}>
            <Typography variant="body2" color="text.secondary">
              Projected Apdex
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Chip
                label={summary.projected_workload_apdex?.toFixed(3) ?? 'N/A'}
                size="small"
                sx={{
                  backgroundColor: getApdexColor(summary.projected_workload_apdex),
                  color: '#fff',
                  mt: 0.5,
                }}
              />
              {showTrendIcon &&
                (isImprovement ? (
                  <TrendingUpIcon color="success" fontSize="small" />
                ) : (
                  <TrendingDownIcon color="error" fontSize="small" />
                ))}
            </Box>
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}
