'use client';

import { useMemo } from 'react';
import { Autocomplete, Box, Button, Card, CardContent, TextField } from '@mui/material';
import { FilterList, FilterListOff } from '@mui/icons-material';
import { FilterOptions } from '../types';

interface TestRunsFiltersProps {
  systemFilter: string;
  environmentFilter: string;
  workloadFilter: string;
  filterOptions: FilterOptions;
  hasActiveFilters: boolean;
  onSystemChange: (value: string) => void;
  onEnvironmentChange: (value: string) => void;
  onWorkloadChange: (value: string) => void;
  onResetFilters: () => void;
}

export function TestRunsFilters({
  systemFilter,
  environmentFilter,
  workloadFilter,
  filterOptions,
  hasActiveFilters,
  onSystemChange,
  onEnvironmentChange,
  onWorkloadChange,
  onResetFilters,
}: TestRunsFiltersProps) {
  return (
    <Card sx={{ mb: 3, flexShrink: 0 }}>
      <CardContent>
        <Box display="flex" gap={2} alignItems="center" flexWrap="wrap">
          <FilterList color="action" />
          <FilterSelect label="System" value={systemFilter} options={filterOptions.systems} onChange={onSystemChange} />
          <FilterSelect label="Environment" value={environmentFilter} options={filterOptions.environments} onChange={onEnvironmentChange} />
          <FilterSelect label="Workload" value={workloadFilter} options={filterOptions.workloads} onChange={onWorkloadChange} />

          <Button
            variant="outlined"
            size="small"
            startIcon={<FilterListOff />}
            onClick={onResetFilters}
            disabled={!hasActiveFilters}
          >
            Clear All
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
}

/** Typeahead over one filter's values, sorted case-insensitively. Cleared means "all". */
function FilterSelect({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  const sorted = useMemo(() => {
    const list = [...options].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    // A URL filter can arrive before (or without) its options; keep it selectable rather than invalid.
    return value && !list.includes(value) ? [...list, value] : list;
  }, [options, value]);
  return (
    <Autocomplete
      size="small"
      sx={{ width: { xs: '100%', sm: 240 } }}
      options={sorted}
      value={value || null}
      onChange={(_, v) => onChange(v ?? '')}
      renderInput={(params) => <TextField {...params} label={label} placeholder="All" slotProps={{ inputLabel: { shrink: true } }} />}
    />
  );
}
