'use client';

import React, { useState, useRef } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  FormGroup,
  FormControlLabel,
  Checkbox,
  Switch,
  Box,
} from '@mui/material';
import { AvailableSources } from '@/lib/refresh-sources';

export interface RefreshSources {
  grafana: boolean;
  dynatrace: boolean;
  performanceMetrics: boolean;
  forceRefetch?: boolean;
}

interface RefreshMissingDataDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (sources: RefreshSources) => void;
  title?: string;
  /** When provided, only show checkboxes for sources that are actually configured. */
  availableSources?: AvailableSources;
}

function initialSources(availableSources?: AvailableSources): RefreshSources {
  return {
    grafana: availableSources?.grafana ?? true,
    dynatrace: availableSources?.dynatrace ?? true,
    performanceMetrics: true,
  };
}

export function RefreshMissingDataDialog({
  open,
  onClose,
  onConfirm,
  title = 'Re-fetch Missing Data',
  availableSources,
}: RefreshMissingDataDialogProps) {
  const [sources, setSources] = useState<RefreshSources>(() => initialSources(availableSources));
  const [forceRefetch, setForceRefetch] = useState(false);

  // Reset state synchronously during render (no flash) when dialog opens.
  // React supports calling setState during render as long as it's gated by a prop change.
  // See: https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const prevOpenRef = useRef(open);
  if (open && !prevOpenRef.current) {
    setSources(initialSources(availableSources));
    setForceRefetch(false);
  }
  prevOpenRef.current = open;

  const showGrafana = availableSources?.grafana ?? true;
  const showDynatrace = availableSources?.dynatrace ?? true;

  const handleToggle = (key: keyof RefreshSources) => {
    setSources(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const noneSelected = !sources.grafana && !sources.dynatrace && !sources.performanceMetrics;

  const handleConfirm = () => {
    onConfirm({ ...sources, forceRefetch });
    onClose();
  };

  const handleClose = () => {
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Select which sources to check for missing data. Only gaps in selected sources will be filled.
          Statistics are recalculated and benchmark checks and ADAPT analysis are re-evaluated afterwards.
        </Typography>
        <FormGroup>
          {showGrafana && (
            <FormControlLabel
              control={
                <Checkbox
                  checked={sources.grafana}
                  onChange={() => handleToggle('grafana')}
                />
              }
              label="Grafana metrics"
            />
          )}
          {showDynatrace && (
            <FormControlLabel
              control={
                <Checkbox
                  checked={sources.dynatrace}
                  onChange={() => handleToggle('dynatrace')}
                />
              }
              label="Dynatrace metrics"
            />
          )}
          <FormControlLabel
            control={
              <Checkbox
                checked={sources.performanceMetrics}
                onChange={() => handleToggle('performanceMetrics')}
              />
            }
            label="Performance test metrics"
          />
        </FormGroup>
        <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
          <FormControlLabel
            control={
              <Switch
                checked={forceRefetch}
                onChange={() => setForceRefetch(prev => !prev)}
                color="warning"
              />
            }
            label="Force re-fetch all data"
          />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4 }}>
            Re-collect all metrics from selected sources, replacing existing data
          </Typography>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <Button
          onClick={handleConfirm}
          variant="contained"
          disabled={noneSelected}
          color={forceRefetch ? 'warning' : 'primary'}
        >
          {forceRefetch ? 'Force Re-fetch All Data' : 'Re-fetch Missing Data'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
