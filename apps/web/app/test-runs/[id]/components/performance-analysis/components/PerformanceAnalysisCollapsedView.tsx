'use client';

import { Box, Divider, Typography, Tooltip } from '@mui/material';
import KPIDisplay from '../../shared/KPIDisplay';
import SoftBadge from '../../shared/SoftBadge';
import { TransactionStat, ThroughputStats } from '../types/performance-analysis.types';
import { formatNumber, getApdexColor, getApdexLabel } from '../utils/performance-formatters';

interface PerformanceAnalysisCollapsedViewProps {
  loading: boolean;
  error: string | null;
  transactions: TransactionStat[];
  throughputStats: ThroughputStats | null;
  overallApdexScore: number;
  poorApdexTransactions: TransactionStat[];
}

export function PerformanceAnalysisCollapsedView({
  loading,
  error,
  transactions,
  throughputStats,
  overallApdexScore,
  poorApdexTransactions,
}: PerformanceAnalysisCollapsedViewProps) {
  const hasPoorApdexTransactions = poorApdexTransactions.length > 0;

  return (
    <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {/* SECTION 2: Primary KPI Display - Overall Apdex Score */}
      <Tooltip
        title={
          <Box>
            <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 0.5 }}>
              Apdex Score: {loading ? 'Loading...' : error ? 'Error' : overallApdexScore.toFixed(3)}
            </Typography>
            <Typography variant="caption" sx={{ fontSize: '0.7rem', display: 'block', mb: 0.5 }}>
              {loading ? '' : error ? '' : `Rating: ${getApdexLabel(overallApdexScore)}`}
            </Typography>
            {!loading && !error && hasPoorApdexTransactions && (
              <>
                <Divider sx={{ my: 0.5, backgroundColor: 'rgba(255, 255, 255, 0.3)' }} />
                <Typography variant="caption" sx={{ fontSize: '0.7rem', display: 'block', color: '#ff9800', fontWeight: 600 }}>
                  {poorApdexTransactions.length} transaction{poorApdexTransactions.length > 1 ? 's have' : ' has'} Apdex &lt; 0.7
                </Typography>
              </>
            )}
            <Divider sx={{ my: 0.5, backgroundColor: 'rgba(255, 255, 255, 0.3)' }} />
            <Typography variant="caption" sx={{ fontSize: '0.7rem', display: 'block', mt: 0.5 }}>
              <strong>Thresholds:</strong>
            </Typography>
            <Typography variant="caption" sx={{ fontSize: '0.7rem', display: 'block' }}>
              Excellent: ≥0.94 | Good: 0.85-0.93 | Fair: 0.70-0.84 | Poor: 0.50-0.69 | Unacceptable: &lt;0.50
            </Typography>
          </Box>
        }
        arrow
        placement="top"
      >
        <Box sx={{ py: 1, cursor: 'help' }}>
          <KPIDisplay
            value={loading ? '—' : error ? 'Error' : transactions.length === 0 ? '—' : getApdexLabel(overallApdexScore)}
            label="Overall Apdex"
            loading={loading}
            color={
              loading || error || transactions.length === 0 ? undefined :
              overallApdexScore >= 0.94 ? 'success' :
              overallApdexScore >= 0.85 ? 'success' :
              overallApdexScore >= 0.7 ? 'warning' : 'error'
            }
          />
        </Box>
      </Tooltip>

      {/* SECTION 3: Secondary Content - Soft Badges */}
      <Box sx={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 1,
        justifyContent: 'center'
      }}>
        {loading && (
          <SoftBadge label="Loading metrics..." color="blue" />
        )}

        {!loading && !error && transactions.length > 0 && (() => {
          // Calculate metrics
          const uniqueScenarios = new Set(transactions.map(t => t.scenario_name)).size;
          const totalRequests = transactions.reduce((sum, t) => sum + t.total_count, 0);
          const weightedAvgResponseTime = totalRequests > 0
            ? transactions.reduce((sum, t) => sum + (t.avg_response_time * t.total_count), 0) / totalRequests
            : 0;

          return (
            <>
              <SoftBadge
                count={uniqueScenarios}
                label={uniqueScenarios !== 1 ? 'scenarios' : 'scenario'}
                color="blue"
              />
              {throughputStats && (
                <>
                  <SoftBadge
                    label={`${throughputStats.overall.peak_transactions_per_second} txn/s`}
                    color="green"
                  />
                  <SoftBadge
                    label={`${throughputStats.overall.peak_requests_per_second} req/s`}
                    color="purple"
                  />
                </>
              )}
              <SoftBadge
                label={`Avg: ${formatNumber(weightedAvgResponseTime)}ms`}
                color="orange"
              />
              {hasPoorApdexTransactions && (
                <SoftBadge
                  count={poorApdexTransactions.length}
                  label="poor Apdex"
                  color="orange"
                />
              )}
            </>
          );
        })()}

        {!loading && !error && transactions.length === 0 && (
          <SoftBadge label="No transactions found" color="neutral" />
        )}
      </Box>
    </Box>
  );
}
