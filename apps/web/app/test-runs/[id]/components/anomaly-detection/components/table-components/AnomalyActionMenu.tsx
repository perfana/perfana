'use client';

import React from 'react';
import {
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Divider,
} from '@mui/material';
import {
  Delete,
  AccountTree as AccountTreeIcon,
  Insights as InsightsIcon,
} from '@mui/icons-material';
import { AnomalyData } from '../../types';
import { parseRequestInfoFromMetric, isPerformanceTestMetricsDashboard } from '../utils';
import { DrillDownFilters } from '../types';

interface AnomalyActionMenuProps {
  anchorEl: HTMLElement | null;
  menuData: AnomalyData | null;
  onClose: () => void;
  onDelete: (anomaly: AnomalyData) => void;
  hasDistributedTracing: boolean;
  hasDynatrace: boolean;
  onDrillDownToDistributedTracing?: (filters: DrillDownFilters) => void;
  onDrillDownToDynatrace?: (filters: DrillDownFilters) => void;
  canDelete: boolean;
}

export function AnomalyActionMenu({
  anchorEl,
  menuData,
  onClose,
  onDelete,
  hasDistributedTracing,
  hasDynatrace,
  onDrillDownToDistributedTracing,
  onDrillDownToDynatrace,
  canDelete,
}: AnomalyActionMenuProps) {
  const showTracingOption = hasDistributedTracing && onDrillDownToDistributedTracing && menuData && isPerformanceTestMetricsDashboard(menuData);
  const showDynatraceOption = hasDynatrace && onDrillDownToDynatrace && menuData && isPerformanceTestMetricsDashboard(menuData);
  const showDivider = (showTracingOption || showDynatraceOption) && canDelete;

  return (
    <Menu
      anchorEl={anchorEl}
      open={Boolean(anchorEl)}
      onClose={onClose}
      anchorOrigin={{
        vertical: 'bottom',
        horizontal: 'right',
      }}
      transformOrigin={{
        vertical: 'top',
        horizontal: 'right',
      }}
    >
      {showTracingOption && (
        <MenuItem onClick={() => {
          if (menuData) {
            const filters = parseRequestInfoFromMetric(menuData);
            onDrillDownToDistributedTracing(filters || {});
          }
          onClose();
        }}>
          <ListItemIcon>
            <AccountTreeIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>View in Distributed Traces</ListItemText>
        </MenuItem>
      )}

      {showDynatraceOption && (
        <MenuItem onClick={() => {
          if (menuData) {
            const filters = parseRequestInfoFromMetric(menuData);
            onDrillDownToDynatrace(filters || {});
          }
          onClose();
        }}>
          <ListItemIcon>
            <InsightsIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>View in Dynatrace</ListItemText>
        </MenuItem>
      )}

      {showDivider && <Divider />}

      {canDelete && (
        <MenuItem
          onClick={() => {
            if (menuData) {
              onDelete(menuData);
            }
            onClose();
          }}
          sx={{ color: 'error.main' }}
        >
          <ListItemIcon>
            <Delete fontSize="small" sx={{ color: 'error.main' }} />
          </ListItemIcon>
          <ListItemText>Delete Anomaly</ListItemText>
        </MenuItem>
      )}
    </Menu>
  );
}
