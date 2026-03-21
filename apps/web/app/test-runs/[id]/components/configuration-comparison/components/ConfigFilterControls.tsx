'use client';

import React from 'react';
import {
  Box,
  Typography,
  Chip,
  Autocomplete,
  TextField,
  IconButton,
} from '@mui/material';
import { ConfigComparison, RelatedTestRun, STATUS_FILTER_OPTIONS } from '../types';
import { getTestRunDisplayText, getTestRunSecondaryInfo } from '../utils/comparison-formatters';

interface ConfigFilterControlsProps {
  relatedTestRuns: RelatedTestRun[];
  selectedRelatedTestRun: string;
  selectedConfigLoading: boolean;
  onRelatedTestRunChange: (testRunId: string) => void;
  allTags: string[];
  selectedTags: string[];
  onTagsChange: (tags: string[]) => void;
  keyFilter: string;
  onKeyFilterChange: (value: string) => void;
  statusFilters: string[];
  onStatusFiltersChange: (filters: string[]) => void;
  configComparisons: ConfigComparison[];
  filteredComparisons: ConfigComparison[];
  configLoading: boolean;
}

export function ConfigFilterControls({
  relatedTestRuns,
  selectedRelatedTestRun,
  selectedConfigLoading,
  onRelatedTestRunChange,
  allTags,
  selectedTags,
  onTagsChange,
  keyFilter,
  onKeyFilterChange,
  statusFilters,
  onStatusFiltersChange,
  configComparisons,
  filteredComparisons,
  configLoading,
}: ConfigFilterControlsProps) {
  return (
    <>
      {/* Related Test Runs Dropdown */}
      {relatedTestRuns.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Autocomplete
            options={relatedTestRuns}
            getOptionLabel={getTestRunDisplayText}
            value={selectedRelatedTestRun
              ? relatedTestRuns.find(tr => tr.test_run_id === selectedRelatedTestRun) || null
              : null}
            onChange={(_, newValue) => onRelatedTestRunChange(newValue?.test_run_id || '')}
            renderInput={(params) => (
              <TextField
                {...params}
                variant="outlined"
                label="Select Test Run for Configuration Comparison"
                placeholder={selectedConfigLoading ? "Loading..." : "Select a test run to compare"}
                fullWidth
                helperText={
                  selectedRelatedTestRun
                    ? `Comparing with: ${selectedRelatedTestRun}`
                    : `Select from ${relatedTestRuns.length} available test runs`
                }
              />
            )}
            renderOption={(props, option) => {
              const { key, ...otherProps } = props;
              return (
                <Box component="li" key={key} {...otherProps}>
                  <Box sx={{ width: '100%' }}>
                    <Typography variant="body1" sx={{ fontWeight: 600 }}>
                      {option.test_run_id}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {new Date(option.start_time || option.created_at).toLocaleString('en-US', {
                        year: 'numeric', month: 'short', day: 'numeric',
                        hour: '2-digit', minute: '2-digit'
                      })}
                    </Typography>
                    {getTestRunSecondaryInfo(option) && (
                      <Typography variant="caption" color="text.secondary">
                        {getTestRunSecondaryInfo(option)}
                      </Typography>
                    )}
                  </Box>
                </Box>
              );
            }}
            loading={selectedConfigLoading}
          />
        </Box>
      )}

      {/* Key and Tag Filters */}
      {!configLoading && (
        <Box sx={{ mb: 3, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <TextField
            variant="outlined"
            label="Filter by key"
            placeholder="Type to filter keys..."
            size="small"
            value={keyFilter}
            onChange={(e) => onKeyFilterChange(e.target.value)}
            sx={{ minWidth: 250, flex: '1 1 250px' }}
            InputProps={{
              endAdornment: keyFilter && (
                <IconButton size="small" onClick={() => onKeyFilterChange('')} sx={{ mr: -1 }}>
                  <Typography sx={{ fontSize: '1rem', color: 'text.secondary' }}>×</Typography>
                </IconButton>
              ),
            }}
          />
          {allTags.length > 0 && (
            <Autocomplete
              multiple
              options={allTags}
              value={selectedTags}
              onChange={(_, newValue) => onTagsChange(newValue)}
              renderTags={(value, getTagProps) =>
                value.map((option, index) => (
                  <Chip variant="filled" label={option} {...getTagProps({ index })} key={index} size="small" />
                ))
              }
              renderInput={(params) => (
                <TextField
                  {...params}
                  variant="outlined"
                  label="Filter by tags"
                  placeholder={selectedTags.length === 0 ? "Select tags..." : ""}
                  size="small"
                />
              )}
              sx={{ minWidth: 300, flex: '1 1 300px' }}
            />
          )}
        </Box>
      )}

      {/* Filter summary */}
      {(keyFilter || selectedTags.length > 0) && (
        <Typography variant="caption" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
          {keyFilter && selectedTags.length > 0
            ? `Filtering by key "${keyFilter}" AND tags: ${selectedTags.join(', ')}`
            : keyFilter ? `Filtering by key "${keyFilter}"` : `Filtering by tags: ${selectedTags.join(', ')}`}
        </Typography>
      )}

      {/* Status Filters */}
      {configComparisons.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle2" sx={{ mb: 2 }}>Show Configuration Status:</Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {STATUS_FILTER_OPTIONS.map((status) => {
              const isSelected = statusFilters.includes(status.value);
              const count = configComparisons.filter(c => c.status === status.value).length;
              return (
                <Chip
                  key={status.value}
                  label={`${status.label} (${count})`}
                  variant={isSelected ? 'filled' : 'outlined'}
                  color={status.color}
                  clickable
                  onClick={() => {
                    if (isSelected) {
                      onStatusFiltersChange(statusFilters.filter(f => f !== status.value));
                    } else {
                      onStatusFiltersChange([...statusFilters, status.value]);
                    }
                  }}
                  disabled={count === 0}
                  sx={{
                    height: '32px', fontWeight: 600, backdropFilter: 'blur(8px)',
                    transition: 'all 0.2s ease', opacity: count === 0 ? 0.5 : 1,
                    cursor: count === 0 ? 'default' : 'pointer',
                    '&:hover': {
                      transform: count === 0 ? 'none' : 'translateY(-1px)',
                      boxShadow: count === 0 ? 'none' : '0 4px 12px rgba(0, 0, 0, 0.15)',
                    },
                    '& .MuiChip-label': { px: 1.5, py: 0, fontSize: '0.8rem' }
                  }}
                />
              );
            })}
            <Box sx={{ ml: 2, display: 'flex', gap: 1 }}>
              <Chip
                label="Clear All"
                clickable
                onClick={() => onStatusFiltersChange([])}
                sx={{
                  height: '28px', fontWeight: 600, backdropFilter: 'blur(8px)',
                  background: 'linear-gradient(135deg, rgba(244, 67, 54, 0.08) 0%, rgba(239, 83, 80, 0.12) 100%)',
                  border: '1px solid rgba(244, 67, 54, 0.3)', color: 'error.dark',
                  '&:hover': { transform: 'translateY(-1px)', boxShadow: '0 4px 12px rgba(244, 67, 54, 0.2)' },
                  '& .MuiChip-label': { px: 1.25, py: 0, fontSize: '0.75rem' }
                }}
              />
              <Chip
                label="Select All"
                clickable
                onClick={() => onStatusFiltersChange(['changed', 'new', 'removed', 'same'])}
                sx={{
                  height: '28px', fontWeight: 600, backdropFilter: 'blur(8px)',
                  background: 'linear-gradient(135deg, rgba(76, 175, 80, 0.08) 0%, rgba(102, 187, 106, 0.12) 100%)',
                  border: '1px solid rgba(76, 175, 80, 0.3)', color: 'success.dark',
                  '&:hover': { transform: 'translateY(-1px)', boxShadow: '0 4px 12px rgba(76, 175, 80, 0.2)' },
                  '& .MuiChip-label': { px: 1.25, py: 0, fontSize: '0.75rem' }
                }}
              />
            </Box>
          </Box>
          {filteredComparisons.length !== configComparisons.length && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              Showing {filteredComparisons.length} of {configComparisons.length} configuration items
            </Typography>
          )}
        </Box>
      )}
    </>
  );
}
