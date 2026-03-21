'use client';

import {
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
} from '@mui/material';
import {
  AccountTree as AccountTreeIcon,
  Insights as InsightsIcon,
} from '@mui/icons-material';
import { Top10Item, DrillDownFilters } from '../types';

export interface Top10ActionMenuProps {
  anchorEl: HTMLElement | null;
  item: Top10Item | null;
  hasDistributedTracing: boolean;
  hasDynatrace: boolean;
  onClose: () => void;
  onDrillDownToDistributedTracing?: (filters: DrillDownFilters) => void;
  onDrillDownToDynatrace?: (filters: DrillDownFilters) => void;
}

export function Top10ActionMenu({
  anchorEl,
  item,
  hasDistributedTracing,
  hasDynatrace,
  onClose,
  onDrillDownToDistributedTracing,
  onDrillDownToDynatrace,
}: Top10ActionMenuProps) {
  const handleDistributedTracingClick = () => {
    if (item && onDrillDownToDistributedTracing) {
      onDrillDownToDistributedTracing({
        scenario: item.scenarioName,
        transaction: item.transactionName,
        sampler: item.requestName,
      });
    }
    onClose();
  };

  const handleDynatraceClick = () => {
    if (item && onDrillDownToDynatrace) {
      onDrillDownToDynatrace({
        scenario: item.scenarioName,
        transaction: item.transactionName,
        sampler: item.requestName,
      });
    }
    onClose();
  };

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
      {hasDistributedTracing && onDrillDownToDistributedTracing && (
        <MenuItem onClick={handleDistributedTracingClick}>
          <ListItemIcon>
            <AccountTreeIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>View in Distributed Traces</ListItemText>
        </MenuItem>
      )}
      {hasDynatrace && onDrillDownToDynatrace && (
        <MenuItem onClick={handleDynatraceClick}>
          <ListItemIcon>
            <InsightsIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>View in Dynatrace</ListItemText>
        </MenuItem>
      )}
    </Menu>
  );
}
