'use client';

import React from 'react';
import { Box, Typography } from '@mui/material';
import { TransactionStat, VirtualUserStats, ThroughputStats } from '../types/performance-analysis.types';
import { formatNumber, formatApdex } from '../utils/performance-formatters';

interface OverallTestMetricsProps {
  transactions: TransactionStat[];
  throughputStats: ThroughputStats | null;
  virtualUserStats: VirtualUserStats | null;
  testLevelThreshold: number;
}

export default function OverallTestMetrics({
  transactions,
  throughputStats,
  virtualUserStats,
  testLevelThreshold,
}: OverallTestMetricsProps) {
  // Calculate metrics
  const totalRequests = transactions.reduce((sum, t) => sum + t.total_count, 0);
  const totalPassed = transactions.reduce((sum, t) => sum + t.passed_count, 0);
  const totalFailed = transactions.reduce((sum, t) => sum + t.failed_count, 0);
  const errorRate = totalRequests > 0 ? (totalFailed / totalRequests) * 100 : 0;

  // Weighted averages
  const weightedAvgResponseTime = totalRequests > 0
    ? transactions.reduce((sum, t) => sum + (t.avg_response_time * t.total_count), 0) / totalRequests
    : 0;
  const weightedP95ResponseTime = totalRequests > 0
    ? transactions.reduce((sum, t) => sum + (t.p95_response_time * t.total_count), 0) / totalRequests
    : 0;
  const weightedP99ResponseTime = totalRequests > 0
    ? transactions.reduce((sum, t) => sum + (t.p99_response_time * t.total_count), 0) / totalRequests
    : 0;
  const weightedApdexScore = totalRequests > 0
    ? transactions.reduce((sum, t) => sum + (t.apdex_score * t.total_count), 0) / totalRequests
    : 0;

  return (
    <Box sx={{ mb: 3 }}>
      <Typography
        variant="subtitle2"
        sx={{
          fontWeight: 700,
          fontSize: '0.9rem',
          color: 'text.secondary',
          mb: 2,
          textTransform: 'uppercase',
          letterSpacing: '0.5px'
        }}
      >
        Overall Test Metrics
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
          gap: 2,
          mb: 2
        }}
      >
        {/* Peak Transactions / Second */}
        {throughputStats && (
          <Box
            sx={{
              p: 2,
              backgroundColor: 'rgba(25, 118, 210, 0.04)',
              borderRadius: 2,
              border: '1px solid rgba(25, 118, 210, 0.12)',
            }}
          >
            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase' }}>
              Peak Transactions / Second
            </Typography>
            <Typography variant="h6" sx={{ fontFamily: 'monospace', fontWeight: 700, color: 'primary.main' }}>
              {throughputStats.overall.peak_transactions_per_second}
            </Typography>
          </Box>
        )}

        {/* Peak Requests / Second */}
        {throughputStats && (
          <Box
            sx={{
              p: 2,
              backgroundColor: 'rgba(156, 39, 176, 0.04)',
              borderRadius: 2,
              border: '1px solid rgba(156, 39, 176, 0.12)',
            }}
          >
            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase' }}>
              Peak Requests / Second
            </Typography>
            <Typography variant="h6" sx={{ fontFamily: 'monospace', fontWeight: 700, color: 'secondary.main' }}>
              {throughputStats.overall.peak_requests_per_second}
            </Typography>
          </Box>
        )}

        {/* Peak Active Users */}
        {virtualUserStats && virtualUserStats.overall.total_data_points > 0 && (
          <Box
            sx={{
              p: 2,
              backgroundColor: 'rgba(33, 150, 243, 0.04)',
              borderRadius: 2,
              border: '1px solid rgba(33, 150, 243, 0.12)',
            }}
          >
            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase' }}>
              Peak Active Users
            </Typography>
            <Typography variant="h6" sx={{ fontFamily: 'monospace', fontWeight: 700, color: 'info.main' }}>
              {virtualUserStats.overall.peak_active_threads}
            </Typography>
            <Typography variant="caption" sx={{ fontSize: '0.65rem', color: 'text.secondary' }}>
              Avg: {formatNumber(virtualUserStats.overall.avg_active_threads)}
            </Typography>
          </Box>
        )}

        {/* Transaction Error Rate */}
        <Box
          sx={{
            p: 2,
            backgroundColor: errorRate > 5 ? 'rgba(244, 67, 54, 0.04)' : 'rgba(76, 175, 80, 0.04)',
            borderRadius: 2,
            border: `1px solid ${errorRate > 5 ? 'rgba(244, 67, 54, 0.12)' : 'rgba(76, 175, 80, 0.12)'}`,
          }}
        >
          <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase' }}>
            Transaction Error Rate
          </Typography>
          <Typography variant="h6" sx={{ fontFamily: 'monospace', fontWeight: 700, color: errorRate > 5 ? 'error.main' : 'success.main' }}>
            {errorRate.toFixed(2)}%
          </Typography>
          <Typography variant="caption" sx={{ fontSize: '0.65rem', color: 'text.secondary' }}>
            {totalFailed.toLocaleString()} transactions failed
          </Typography>
        </Box>

        {/* Avg Response Time */}
        <Box
          sx={{
            p: 2,
            backgroundColor: 'rgba(33, 150, 243, 0.04)',
            borderRadius: 2,
            border: '1px solid rgba(33, 150, 243, 0.12)',
          }}
        >
          <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase' }}>
            Avg Response Time
          </Typography>
          <Typography variant="h6" sx={{ fontFamily: 'monospace', fontWeight: 700, color: 'info.main' }}>
            {formatNumber(weightedAvgResponseTime)} ms
          </Typography>
          <Typography variant="caption" sx={{ fontSize: '0.65rem', color: 'text.secondary' }}>
            Weighted average
          </Typography>
        </Box>

        {/* P95 Response Time */}
        <Box
          sx={{
            p: 2,
            backgroundColor: 'rgba(255, 152, 0, 0.04)',
            borderRadius: 2,
            border: '1px solid rgba(255, 152, 0, 0.12)',
          }}
        >
          <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase' }}>
            P95 Response Time
          </Typography>
          <Typography variant="h6" sx={{ fontFamily: 'monospace', fontWeight: 700, color: 'warning.main' }}>
            {formatNumber(weightedP95ResponseTime)} ms
          </Typography>
          <Typography variant="caption" sx={{ fontSize: '0.65rem', color: 'text.secondary' }}>
            95th percentile
          </Typography>
        </Box>

        {/* P99 Response Time */}
        <Box
          sx={{
            p: 2,
            backgroundColor: 'rgba(244, 67, 54, 0.04)',
            borderRadius: 2,
            border: '1px solid rgba(244, 67, 54, 0.12)',
          }}
        >
          <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase' }}>
            P99 Response Time
          </Typography>
          <Typography variant="h6" sx={{ fontFamily: 'monospace', fontWeight: 700, color: 'error.main' }}>
            {formatNumber(weightedP99ResponseTime)} ms
          </Typography>
          <Typography variant="caption" sx={{ fontSize: '0.65rem', color: 'text.secondary' }}>
            99th percentile
          </Typography>
        </Box>

        {/* Overall Apdex Score */}
        <Box
          sx={{
            p: 2,
            backgroundColor: weightedApdexScore >= 0.94 ? 'rgba(76, 175, 80, 0.04)' : weightedApdexScore >= 0.85 ? 'rgba(255, 152, 0, 0.04)' : weightedApdexScore >= 0.70 ? 'rgba(255, 193, 7, 0.04)' : 'rgba(244, 67, 54, 0.04)',
            borderRadius: 2,
            border: `1px solid ${weightedApdexScore >= 0.94 ? 'rgba(76, 175, 80, 0.12)' : weightedApdexScore >= 0.85 ? 'rgba(255, 152, 0, 0.12)' : weightedApdexScore >= 0.70 ? 'rgba(255, 193, 7, 0.12)' : 'rgba(244, 67, 54, 0.12)'}`,
          }}
        >
          <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase' }}>
            Overall Apdex Score
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
            <Typography variant="h6" sx={{ fontFamily: 'monospace', fontWeight: 700, color: weightedApdexScore >= 0.94 ? 'success.main' : weightedApdexScore >= 0.85 ? 'warning.main' : weightedApdexScore >= 0.70 ? 'warning.dark' : 'error.main' }}>
              {formatApdex(weightedApdexScore)}
            </Typography>
            <Typography
              variant="caption"
              sx={{
                fontSize: '0.7rem',
                fontWeight: 700,
                color: weightedApdexScore >= 0.94 ? 'success.main' : weightedApdexScore >= 0.85 ? 'warning.main' : weightedApdexScore >= 0.70 ? 'warning.dark' : 'error.main',
                textTransform: 'uppercase',
                letterSpacing: '0.5px'
              }}
            >
              {weightedApdexScore >= 0.94 ? 'Excellent' : weightedApdexScore >= 0.85 ? 'Good' : weightedApdexScore >= 0.70 ? 'Fair' : weightedApdexScore >= 0.50 ? 'Poor' : 'Unacceptable'}
            </Typography>
          </Box>
          <Typography variant="caption" sx={{ fontSize: '0.65rem', color: 'text.secondary' }}>
            T={testLevelThreshold}ms
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}
