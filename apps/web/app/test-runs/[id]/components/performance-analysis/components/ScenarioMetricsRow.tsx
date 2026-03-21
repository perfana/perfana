'use client';

import {
  Box,
  Typography,
  TableCell,
  TableRow,
  Tooltip,
} from '@mui/material';
import { ThroughputStats, VirtualUserStats } from '../types/performance-analysis.types';
import {
  formatNumber,
  formatApdex,
  getApdexColor,
  getApdexLabel,
  ScenarioMetrics,
} from '../utils/performance-formatters';

export interface ScenarioMetricsRowProps {
  scenarioName: string;
  metrics: ScenarioMetrics;
  throughputStats: ThroughputStats | null;
  virtualUserStats: VirtualUserStats | null;
  onToggleScenario: (scenarioName: string) => void;
}

export function ScenarioMetricsRow({
  scenarioName,
  metrics,
  throughputStats,
  virtualUserStats,
  onToggleScenario,
}: ScenarioMetricsRowProps) {
  const scenarioThroughput = throughputStats?.by_scenario?.find(s => s.scenario_name === scenarioName);
  const scenarioVU = virtualUserStats?.by_scenario?.find(s => s.scenario_name === scenarioName);

  return (
    <TableRow
      onClick={() => onToggleScenario(scenarioName)}
      sx={{
        cursor: 'pointer',
        '&:hover': {
          backgroundColor: 'rgba(25, 118, 210, 0.04)',
        }
      }}
    >
      <TableCell colSpan={10} sx={{
        backgroundColor: 'rgba(25, 118, 210, 0.02)',
        borderBottom: '1px solid rgba(25, 118, 210, 0.1)',
        py: 2
      }}>
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)', lg: 'repeat(8, 1fr)' },
          gap: 1.5
        }}>
          {/* Peak Transactions / Second */}
          {scenarioThroughput && (
            <Box sx={{ textAlign: 'center', px: 1 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem', fontWeight: 600, textTransform: 'uppercase', display: 'block' }}>
                Peak Txns / Sec
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 700, color: 'primary.main', fontSize: '0.9rem' }}>
                {scenarioThroughput.peak_transactions_per_second}
              </Typography>
            </Box>
          )}

          {/* Peak Requests / Second */}
          {scenarioThroughput && (
            <Box sx={{ textAlign: 'center', px: 1 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem', fontWeight: 600, textTransform: 'uppercase', display: 'block' }}>
                Peak Reqs / Sec
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 700, color: 'secondary.main', fontSize: '0.9rem' }}>
                {scenarioThroughput.peak_requests_per_second}
              </Typography>
            </Box>
          )}

          {/* Peak Active Users */}
          {scenarioVU && (
            <Box sx={{ textAlign: 'center', px: 1 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem', fontWeight: 600, textTransform: 'uppercase', display: 'block' }}>
                Peak VU
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 700, color: 'info.main', fontSize: '0.9rem' }}>
                {scenarioVU.peak_active_threads}
              </Typography>
            </Box>
          )}

          {/* Error Rate */}
          <Box sx={{ textAlign: 'center', px: 1 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem', fontWeight: 600, textTransform: 'uppercase', display: 'block' }}>
              Errors
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 700, color: metrics.errorRate > 5 ? 'error.main' : 'success.main', fontSize: '0.9rem' }}>
              {metrics.errorRate.toFixed(2)}%
            </Typography>
          </Box>

          {/* Avg Response Time */}
          <Box sx={{ textAlign: 'center', px: 1 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem', fontWeight: 600, textTransform: 'uppercase', display: 'block' }}>
              Avg (ms)
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 700, color: 'info.main', fontSize: '0.9rem' }}>
              {formatNumber(metrics.weightedAvgResponseTime)}
            </Typography>
          </Box>

          {/* P95 Response Time */}
          <Box sx={{ textAlign: 'center', px: 1 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem', fontWeight: 600, textTransform: 'uppercase', display: 'block' }}>
              P95 (ms)
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 700, color: 'warning.main', fontSize: '0.9rem' }}>
              {formatNumber(metrics.weightedP95ResponseTime)}
            </Typography>
          </Box>

          {/* P99 Response Time */}
          <Box sx={{ textAlign: 'center', px: 1 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem', fontWeight: 600, textTransform: 'uppercase', display: 'block' }}>
              P99 (ms)
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 700, color: 'error.main', fontSize: '0.9rem' }}>
              {formatNumber(metrics.weightedP99ResponseTime)}
            </Typography>
          </Box>

          {/* Apdex Score */}
          <Tooltip
            title={
              <Box sx={{ p: 0.5 }}>
                <Typography variant="caption" sx={{ display: 'block', fontWeight: 700, mb: 0.5 }}>
                  Apdex Score: {formatApdex(metrics.weightedApdexScore)}
                </Typography>
                <Typography variant="caption" sx={{ display: 'block', fontSize: '0.7rem' }}>
                  Rating: {getApdexLabel(metrics.weightedApdexScore)}
                </Typography>
                <Typography variant="caption" sx={{ display: 'block', fontSize: '0.7rem', mt: 0.5 }}>
                  Weighted average across {metrics.totalRequests.toLocaleString()} total requests
                </Typography>
              </Box>
            }
            arrow
            placement="top"
          >
            <Box sx={{ textAlign: 'center', px: 1, cursor: 'help' }}>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem', fontWeight: 600, textTransform: 'uppercase', display: 'block' }}>
                Apdex
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 700, color: getApdexColor(metrics.weightedApdexScore), fontSize: '0.9rem' }}>
                {getApdexLabel(metrics.weightedApdexScore)}
              </Typography>
            </Box>
          </Tooltip>
        </Box>
      </TableCell>
    </TableRow>
  );
}
