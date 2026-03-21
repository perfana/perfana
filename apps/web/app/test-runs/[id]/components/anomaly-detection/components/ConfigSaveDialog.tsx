import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  RadioGroup,
  FormControlLabel,
  Radio,
  Typography,
  Box
} from '@mui/material';

export interface ConfigSaveDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (updateOption: 'none' | 'current' | 'all') => void;
  loading?: boolean;
}

export default function ConfigSaveDialog({
  open,
  onClose,
  onSave,
  loading = false
}: ConfigSaveDialogProps) {
  const [selectedOption, setSelectedOption] = React.useState<'none' | 'current' | 'all'>('none');

  const handleSave = () => {
    onSave(selectedOption);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          minHeight: '300px'
        }
      }}
    >
      <DialogTitle>
        <Typography variant="h6" component="div">
          Save Configuration Changes
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          How would you like to handle the analysis after saving your configuration changes?
        </Typography>
      </DialogTitle>

      <DialogContent>
        <RadioGroup
          value={selectedOption}
          onChange={(e) => setSelectedOption(e.target.value as 'none' | 'current' | 'all')}
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
                  Save configuration changes only. Analysis results will remain as-is and may appear outdated.
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
                  Update analysis for this test run
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Re-analyze this specific test run with the new configuration settings.
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
                  Update analysis for all test runs
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
        <Button
          onClick={onClose}
          disabled={loading}
          color="inherit"
        >
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={loading}
        >
          {loading ? 'Saving...' : 'Save Configuration'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}