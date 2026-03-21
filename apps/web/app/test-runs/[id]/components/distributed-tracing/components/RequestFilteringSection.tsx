'use client';

import {
  Box,
  Typography,
  TextField,
  Autocomplete,
  Paper,
} from '@mui/material';
import { RequestFilteringSectionProps } from '../types';

export function RequestFilteringSection({
  scenarios,
  transactions,
  samplers,
  selectedScenario,
  selectedTransaction,
  selectedSampler,
  minDuration,
  maxDuration,
  onScenarioChange,
  onTransactionChange,
  onSamplerChange,
  onMinDurationChange,
  onMaxDurationChange,
}: RequestFilteringSectionProps) {
  return (
    <Paper
      elevation={1}
      sx={{
        p: 3,
        borderRadius: 3,
        backgroundColor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        transition: 'all 0.2s ease-in-out',
        mb: 3,
      }}
    >
      <Box sx={{ mb: 2.5 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, color: 'text.primary', mb: 0.5 }}>
          Request Filtering
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Filter by request name hierarchy and response time duration
        </Typography>
      </Box>

      {/* Hierarchical Request Name Filters */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1fr 1fr 1fr' },
          gap: 2,
          mb: 2,
        }}
      >
        {/* Scenario Filter */}
        <Autocomplete
          size="small"
          options={scenarios}
          value={selectedScenario}
          onChange={(_event, newValue) => {
            onScenarioChange(newValue);
            onTransactionChange(null);
            onSamplerChange(null);
          }}
          renderInput={(params) => (
            <TextField {...params} label="Scenario" placeholder="Select scenario" />
          )}
        />

        {/* Transaction Filter */}
        <Autocomplete
          size="small"
          options={transactions}
          value={selectedTransaction}
          onChange={(_event, newValue) => {
            onTransactionChange(newValue);
            onSamplerChange(null);
          }}
          disabled={!selectedScenario}
          renderInput={(params) => (
            <TextField {...params} label="Transaction" placeholder="Select transaction" />
          )}
        />

        {/* Sampler Filter */}
        <Autocomplete
          size="small"
          options={samplers}
          value={selectedSampler}
          onChange={(_event, newValue) => onSamplerChange(newValue)}
          disabled={!selectedTransaction}
          renderInput={(params) => (
            <TextField {...params} label="Sampler" placeholder="Select sampler" />
          )}
        />
      </Box>

      {/* Duration Filters */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
          gap: 2,
        }}
      >
        {/* Min Duration Filter */}
        <TextField
          size="small"
          label="Min Duration (ms)"
          type="number"
          value={minDuration}
          onChange={(e) => onMinDurationChange(e.target.value)}
          placeholder="e.g., 100"
        />

        {/* Max Duration Filter */}
        <TextField
          size="small"
          label="Max Duration (ms)"
          type="number"
          value={maxDuration}
          onChange={(e) => onMaxDurationChange(e.target.value)}
          placeholder="e.g., 5000"
        />
      </Box>
    </Paper>
  );
}
