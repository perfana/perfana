'use client';

import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  RadioGroup,
  Radio,
  FormControlLabel,
} from '@mui/material';
import { SaveDialogOption } from '../types';

interface SLOSaveDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (option: SaveDialogOption) => void;
  selectedOption: SaveDialogOption;
  onOptionChange: (option: SaveDialogOption) => void;
  loading: boolean;
}

export function SLOSaveDialog({
  open,
  onClose,
  onConfirm,
  selectedOption,
  onOptionChange,
  loading,
}: SLOSaveDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          minHeight: '300px',
        },
      }}
    >
      <DialogTitle>
        <Typography variant="h6" component="div">
          Save SLO Configuration Changes
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          How would you like to handle the analysis after saving your SLO configuration changes?
        </Typography>
      </DialogTitle>

      <DialogContent>
        <RadioGroup
          value={selectedOption}
          onChange={(e) => onOptionChange(e.target.value as SaveDialogOption)}
        >
          <FormControlLabel
            value="none"
            control={<Radio />}
            label={
              <Box>
                <Typography variant="body1" sx={{ fontWeight: 500 }}>
                  Without updating analysis
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Save SLO configuration changes only. Existing analysis results will remain as-is and may appear
                  outdated.
                </Typography>
              </Box>
            }
            sx={{ mb: 2, alignItems: 'flex-start' }}
          />

          <FormControlLabel
            value="current"
            control={<Radio />}
            label={
              <Box>
                <Typography variant="body1" sx={{ fontWeight: 500 }}>
                  Re-evaluate this test run
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Re-evaluate this specific test run with the updated SLO configuration.
                </Typography>
              </Box>
            }
            sx={{ mb: 2, alignItems: 'flex-start' }}
          />

          <FormControlLabel
            value="all"
            control={<Radio />}
            label={
              <Box>
                <Typography variant="body1" sx={{ fontWeight: 500 }}>
                  Re-evaluate all test runs
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Re-analyze all test runs up to the latest identified change point with the new configuration.
                </Typography>
              </Box>
            }
            sx={{ mb: 1, alignItems: 'flex-start' }}
          />
        </RadioGroup>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={loading} color="inherit">
          Cancel
        </Button>
        <Button onClick={() => onConfirm(selectedOption)} variant="contained" disabled={loading}>
          {loading ? 'Saving...' : 'Save Configuration'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
