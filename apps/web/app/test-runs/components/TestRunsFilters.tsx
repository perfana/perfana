'use client';

import {
  Box,
  Card,
  CardContent,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
} from '@mui/material';
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
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>System</InputLabel>
            <Select
              value={systemFilter}
              label="System"
              onChange={(e) => onSystemChange(e.target.value)}
            >
              <MenuItem value="">All Systems</MenuItem>
              {filterOptions.systems.map(system => (
                <MenuItem key={system} value={system}>{system}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>Environment</InputLabel>
            <Select
              value={environmentFilter}
              label="Environment"
              onChange={(e) => onEnvironmentChange(e.target.value)}
            >
              <MenuItem value="">All Environments</MenuItem>
              {filterOptions.environments.map(env => (
                <MenuItem key={env} value={env}>{env}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>Workload</InputLabel>
            <Select
              value={workloadFilter}
              label="Workload"
              onChange={(e) => onWorkloadChange(e.target.value)}
            >
              <MenuItem value="">All Workloads</MenuItem>
              {filterOptions.workloads.map(workload => (
                <MenuItem key={workload} value={workload}>{workload}</MenuItem>
              ))}
            </Select>
          </FormControl>

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
