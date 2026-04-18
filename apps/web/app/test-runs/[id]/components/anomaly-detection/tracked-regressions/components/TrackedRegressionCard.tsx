'use client';

import React from 'react';
import { Card, CardContent, Grid, Collapse, Box } from '@mui/material';
import { TrackedRegressionCardProps } from '../types';
import { RegressionHeader } from './RegressionHeader';
import { RegressionActionButtons } from './RegressionActionButtons';
import { RegressionExpandedContent } from './RegressionExpandedContent';

export const TrackedRegressionCard: React.FC<TrackedRegressionCardProps> = ({
  regression,
  expanded,
  onToggle,
  onResolve,
  isOldest,
  position,
  totalCount,
  correlatedRegressions,
  selectedMetric,
  onMetricChange,
  chartData,
  resolving
}) => {
  const severityColor = Math.abs(regression.percentageChange) > 10 ? 'error' : 'warning';

  const handleExpand = () => {
    const wasCollapsed = !expanded;
    onToggle();

    if (wasCollapsed) {
      setTimeout(() => {
        const expandedCard = document.querySelector(`[data-testid="tracked-regression-${regression.id}"]`);
        if (expandedCard) {
          (expandedCard as HTMLElement).focus({ preventScroll: true });
        }
      }, 300);
    }
  };

  return (
    <Card
      data-testid={expanded ? `tracked-regression-${regression.id}` : undefined}
      tabIndex={expanded ? 0 : -1}
      sx={{
        border: '1px solid',
        borderColor: 'warning.main',
        borderLeft: '4px solid',
        borderLeftColor: severityColor === 'error' ? 'error.main' : 'warning.main',
        '&:hover': { boxShadow: 2 },
        '&:focus': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: '2px' }
      }}
    >
      <CardContent>
        <Grid container alignItems="center" spacing={2}>
          <Grid size={{ xs: 12, md: 8 }}>
            <RegressionHeader
              regression={regression}
              expanded={expanded}
              onToggle={handleExpand}
              isOldest={isOldest}
              position={position}
              totalCount={totalCount}
            />
          </Grid>

          <Grid size={{ xs: 12, md: 4 }}>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
              <RegressionActionButtons
                regressionId={regression.id}
                isOldest={isOldest}
                resolving={resolving}
                onResolve={onResolve}
              />
            </Box>
          </Grid>
        </Grid>

        <Collapse in={expanded}>
          <RegressionExpandedContent
            regression={regression}
            correlatedRegressions={correlatedRegressions}
            selectedMetric={selectedMetric}
            onMetricChange={onMetricChange}
            chartData={chartData}
            isOldest={isOldest}
          />
        </Collapse>
      </CardContent>
    </Card>
  );
};
