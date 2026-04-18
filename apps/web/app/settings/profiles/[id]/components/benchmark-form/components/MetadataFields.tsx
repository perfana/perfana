'use client';

import React from 'react';
import {
  Grid,
  TextField,
  Autocomplete,
  Chip,
} from '@mui/material';

interface MetadataFieldsProps {
  workloadPattern: string;
  tags: string[];
  onWorkloadPatternChange: (value: string) => void;
  onTagsChange: (tags: string[]) => void;
}

export function MetadataFields({
  workloadPattern,
  tags,
  onWorkloadPatternChange,
  onTagsChange,
}: MetadataFieldsProps) {
  return (
    <>
      {/* Workload Pattern */}
      <Grid size={{ xs: 12 }}>
        <TextField
          fullWidth
          label="Workload Pattern (Regex)"
          value={workloadPattern}
          onChange={(e) => onWorkloadPatternChange(e.target.value)}
          placeholder="e.g. .*, load-test-*, production.*"
          helperText="Regex pattern to match test run workloads (default: .* matches all)"
        />
      </Grid>

      {/* Tags */}
      <Grid size={{ xs: 12 }}>
        <Autocomplete
          multiple
          freeSolo
          options={[]}
          value={tags}
          onChange={(_, newValue) => onTagsChange(newValue)}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Tags"
              placeholder="Add tags..."
              helperText="Press Enter to add a tag"
            />
          )}
          renderTags={(value, getTagProps) =>
            value.map((option, index) => {
              const { key, ...otherProps } = getTagProps({ index });
              return (
                <Chip
                  key={key}
                  variant="outlined"
                  label={option}
                  {...otherProps}
                />
              );
            })
          }
        />
      </Grid>
    </>
  );
}
