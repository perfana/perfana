'use client';

import React from 'react';
import {
  Box,
  Typography,
  CircularProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Tooltip,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  ArrowDropUp,
  ArrowDropDown,
  Remove,
  HelpOutline,
} from '@mui/icons-material';
import { AnomalyData } from '../../types';
import { formatValueWithUnit } from '@/lib/units';
import { getConclusionColor } from '../../helpers';
import { formatNumber, getConfigSourceInfo, generateThresholdData } from '../utils';

interface StatisticalDrawerContentProps {
  drawerData: DrawerData;
  drawerLoading: boolean;
  row: AnomalyData;
}

export function StatisticalDrawerContent({
  drawerData,
  drawerLoading,
  row,
}: StatisticalDrawerContentProps) {
  if (drawerLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" py={4}>
        <CircularProgress size={20} />
        <Typography variant="body2" color="text.secondary" sx={{ ml: 2 }}>
          Loading details...
        </Typography>
      </Box>
    );
  }

  if (!drawerData) {
    return (
      <Typography variant="body2" color="text.secondary" textAlign="center" py={4}>
        No detailed statistics available for this metric.
      </Typography>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Thresholds */}
      {((drawerData.checks && drawerData.compare_config) || drawerData.thresholds) && (
        <Paper sx={{ p: 0 }}>
          <Box sx={{ p: 1.5, pb: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              Thresholds
            </Typography>
            {(() => {
              const rawSource = drawerData.compare_config?.source;
              const configSource = rawSource === 'metric' ? 'metric-specific' :
                                  rawSource === 'panel' ? 'panel-level' : 'default';
              const configSourceInfo = getConfigSourceInfo(configSource);
              return (
                <Chip
                  label={configSourceInfo.label}
                  color={configSourceInfo.color}
                  size="small"
                  variant="outlined"
                />
              );
            })()}
          </Box>
          <TableContainer>
            <Table size="small" sx={{ minWidth: 300 }}>
              <TableHead>
                <TableRow sx={{ backgroundColor: 'action.hover' }}>
                  <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', py: 1 }}>Threshold</TableCell>
                  <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', py: 1 }}>Threshold value</TableCell>
                  <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', py: 1 }}>Valid range</TableCell>
                  <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', py: 1 }}>Test value</TableCell>
                  <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', py: 1, textAlign: 'center' }}>Result</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {generateThresholdData(drawerData, row.unit ?? undefined).map((threshold, index) => (
                  <TableRow key={index} sx={{ '&:last-child td, &:last-child th': { border: 0 } }}>
                    <TableCell sx={{ fontSize: '0.75rem', py: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 500, fontSize: '0.75rem' }}>
                        {threshold.threshold}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ fontSize: '0.75rem', py: 1 }}>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 500, fontSize: '0.75rem' }}>
                        {threshold.configuredValue}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ fontSize: '0.75rem', py: 1 }}>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 500, fontSize: '0.75rem' }}>
                        {threshold.thresholdValue}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ fontSize: '0.75rem', py: 1, fontFamily: 'monospace' }}>{threshold.observedDifference}</TableCell>
                    <TableCell sx={{ fontSize: '0.75rem', py: 1, textAlign: 'center' }}>
                      {threshold.result === 'improvement' || threshold.result === 'regression' ? (
                        <Chip
                          label={threshold.result === 'improvement' ? 'Improvement' : 'Regression'}
                          size="small"
                          color={threshold.result === 'improvement' ? 'success' : 'error'}
                          variant="outlined"
                          icon={threshold.side === 'above' ? <ArrowDropUp /> : threshold.side === 'below' ? <ArrowDropDown /> : undefined}
                          sx={{ height: '22px', fontSize: '0.7rem', '& .MuiChip-icon': { fontSize: '1.25rem', ml: 0.25, mr: -0.75 } }}
                        />
                      ) : threshold.result === 'invalid' ? (
                        <Tooltip title={threshold.reason ?? 'This threshold could not be evaluated.'} arrow>
                          <Chip
                            label="N/A"
                            size="small"
                            variant="outlined"
                            icon={<HelpOutline />}
                            sx={{ height: '22px', fontSize: '0.7rem', color: 'text.secondary', cursor: 'help', '& .MuiChip-icon': { fontSize: '0.85rem', color: 'text.disabled' } }}
                          />
                        </Tooltip>
                      ) : threshold.result === 'skipped' ? (
                        <Typography variant="caption" sx={{ color: 'text.disabled' }}>Not set</Typography>
                      ) : (
                        <Chip
                          label="In range"
                          size="small"
                          variant="outlined"
                          icon={<Remove />}
                          sx={{ height: '22px', fontSize: '0.7rem', color: 'text.secondary', '& .MuiChip-icon': { fontSize: '0.9rem', color: 'text.disabled' } }}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* Conclusion */}
      {drawerData.conclusion && drawerData.conclusion.label && (
        <Paper sx={{ p: 1.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              Conclusion
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'flex-start', gap: 1 }}>
            <Chip
              label={drawerData.conclusion.label}
              size="small"
              color={getConclusionColor(drawerData.conclusion.label) as 'default' | 'error' | 'success' | 'warning'}
              variant="filled"
              sx={{ height: '28px', fontSize: '0.75rem' }}
            />
          </Box>
        </Paper>
      )}

      {/* Statistical Summary Table */}
      {(drawerData.mean || drawerData.q25) && (
        <Paper sx={{ p: 0, overflow: 'hidden' }}>
          <Box sx={{ p: 1.5, pb: 1 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              Statistical Summary
            </Typography>
          </Box>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ backgroundColor: 'action.hover' }}>
                  <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>Statistic</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600, fontSize: '0.75rem' }}>Test</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600, fontSize: '0.75rem' }}>Control</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600, fontSize: '0.75rem' }}>Difference</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {/* Basic Statistics */}
                {['mean', 'median', 'std', 'min', 'max', 'iqr'].map(stat => {
                  const isPrimaryStatistic = drawerData.statistic?.name === stat;
                  return drawerData[stat] && (
                    <StatisticRow
                      key={stat}
                      stat={stat}
                      data={drawerData[stat]}
                      isPrimary={isPrimaryStatistic}
                      unit={row.unit ?? undefined}
                      isIqr={stat === 'iqr'}
                    />
                  );
                })}

                {/* Quantiles */}
                {['q10', 'q25', 'q75', 'q90', 'q95', 'q99'].map(quantile => {
                  const isPrimaryStatistic = drawerData.statistic?.name === quantile;
                  return drawerData[quantile] && (
                    <StatisticRow
                      key={quantile}
                      stat={quantile}
                      data={drawerData[quantile]}
                      isPrimary={isPrimaryStatistic}
                      unit={row.unit ?? undefined}
                      isQuantile
                    />
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}
    </Box>
  );
}

interface StatisticRowProps {
  stat: string;
  data: { test: number; control: number; diff: number };
  isPrimary: boolean;
  unit?: string;
  isIqr?: boolean;
  isQuantile?: boolean;
}

function StatisticRow({ stat, data, isPrimary, unit, isIqr, isQuantile }: StatisticRowProps) {
  const getDiffColor = () => {
    if (isIqr) {
      const factor = data.control !== 0 ? data.test / data.control : Infinity;
      return factor > 1 ? 'error.main' : factor < 1 ? 'success.main' : 'text.primary';
    }
    return data.diff > 0 ? 'error.main' : data.diff < 0 ? 'success.main' : 'text.primary';
  };

  const getDiffWeight = () => {
    if (isIqr) {
      const factor = data.control !== 0 ? data.test / data.control : Infinity;
      return factor !== 1 ? 600 : 400;
    }
    return data.diff !== 0 ? 600 : 400;
  };

  const formatDiffValue = () => {
    if (isIqr) {
      if (data.control === 0) return '∞';
      const factor = data.test / data.control;
      if (factor > 1000) return '∞';
      return `×${formatNumber(factor)}`;
    }
    return (data.diff > 0 ? '+' : '') + formatValueWithUnit(data.diff, unit);
  };

  const displayName = isQuantile
    ? stat.toUpperCase().replace('Q', 'P')
    : stat;

  return (
    <TableRow
      sx={(theme) => ({
        '&:hover': { backgroundColor: 'action.hover' },
        backgroundColor: isPrimary ? alpha(theme.palette.primary.main, 0.04) : 'transparent'
      })}
    >
      <TableCell sx={{
        textTransform: 'capitalize',
        fontSize: '0.75rem',
        fontWeight: isPrimary ? 600 : 500,
        position: 'relative',
        color: isPrimary ? 'primary.main' : 'text.primary'
      }}>
        {isPrimary && (
          <Box
            component="span"
            sx={{
              position: 'absolute',
              left: '-8px',
              top: '50%',
              transform: 'translateY(-50%)',
              width: '3px',
              height: '12px',
              backgroundColor: 'primary.main',
              borderRadius: '0 2px 2px 0'
            }}
          />
        )}
        {displayName} {isPrimary && '★'}
      </TableCell>
      <TableCell align="right" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
        {formatValueWithUnit(data.test, unit)}
      </TableCell>
      <TableCell align="right" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
        {formatValueWithUnit(data.control, unit)}
      </TableCell>
      <TableCell align="right" sx={{
        fontFamily: 'monospace',
        fontSize: '0.75rem',
        color: getDiffColor(),
        fontWeight: getDiffWeight()
      }}>
        {formatDiffValue()}
      </TableCell>
    </TableRow>
  );
}
