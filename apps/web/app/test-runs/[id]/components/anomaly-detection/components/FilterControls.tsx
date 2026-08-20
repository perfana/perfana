import type { SelectChangeEvent } from '@mui/material';
import React from 'react';
import {
  Box,
  Button,
  TextField,
  InputAdornment,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Typography
} from '@mui/material';
import {
  Search as SearchIcon,
  FilterListOff,
} from '@mui/icons-material';
import { getClassificationDisplayInfo } from '../helpers';

interface FilterControlsProps {
  searchQuery: string;
  handleSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  conclusionFilter: string;
  handleConclusionFilterChange: (e: SelectChangeEvent<string>) => void;
  classificationFilter: string;
  handleClassificationFilterChange: (e: SelectChangeEvent<string>) => void;
  dashboardFilter: string;
  handleDashboardFilterChange: (e: SelectChangeEvent<string>) => void;
  panelFilter: string;
  handlePanelFilterChange: (e: SelectChangeEvent<string>) => void;
  conclusionsForDropdown: string[];
  classificationsForDropdown: string[];
  dashboardsForDropdown: string[];
  panelsForDropdown: string[];
  filteredData: unknown[];
  anomalyData: unknown[];
  hasActiveFilters: boolean;
  onClearAllFilters: () => void;
}

export default function FilterControls({
  searchQuery,
  handleSearchChange,
  conclusionFilter,
  handleConclusionFilterChange,
  classificationFilter,
  handleClassificationFilterChange,
  dashboardFilter,
  handleDashboardFilterChange,
  panelFilter,
  handlePanelFilterChange,
  conclusionsForDropdown,
  classificationsForDropdown,
  dashboardsForDropdown,
  panelsForDropdown,
  filteredData,
  anomalyData,
  hasActiveFilters,
  onClearAllFilters,
}: FilterControlsProps) {
  return (
    <Box sx={{
      display: 'grid',
      gridTemplateColumns: '40px minmax(200px, 1fr) minmax(180px, 1fr) minmax(160px, 1fr) minmax(120px, 0.8fr) minmax(100px, 0.7fr) minmax(100px, 0.6fr) minmax(100px, 0.6fr) minmax(120px, 0.7fr) 50px',
      gap: 1,
      alignItems: 'center',
      width: '100%',
      overflowX: 'auto',
      px: 2,
      py: 1.5,
      mb: 1,
      mt: 2,
      minWidth: '1000px'
    }}>
      {/* Empty cell aligned with expand arrow column */}
      <Box />

      {/* Dashboard filter - aligned with Dashboard column */}
      <FormControl variant="outlined" size="small" fullWidth>
        <InputLabel>Dashboard</InputLabel>
        <Select
          value={dashboardFilter || 'all'}
          onChange={handleDashboardFilterChange}
          label="Dashboard"
        >
          <MenuItem value="all">All</MenuItem>
          {dashboardsForDropdown.map((dashboard) => (
            <MenuItem key={dashboard} value={dashboard}>
              {dashboard}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {/* Panel filter - aligned with Panel column */}
      <FormControl variant="outlined" size="small" fullWidth>
        <InputLabel>Panel</InputLabel>
        <Select
          value={panelFilter || 'all'}
          onChange={handlePanelFilterChange}
          label="Panel"
        >
          <MenuItem value="all">All</MenuItem>
          {panelsForDropdown.map((panel) => (
            <MenuItem key={panel} value={panel}>
              {panel}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {/* Search - aligned with Metric column */}
      <TextField
        variant="outlined"
        placeholder="Search..."
        value={searchQuery || ''}
        onChange={handleSearchChange}
        size="small"
        fullWidth
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon color="action" sx={{ fontSize: '1rem' }} />
            </InputAdornment>
          ),
        }}
      />

      {/* Classification filter - aligned with Classification column */}
      <FormControl variant="outlined" size="small" fullWidth>
        <InputLabel>Classification</InputLabel>
        <Select
          value={classificationFilter || 'all'}
          onChange={handleClassificationFilterChange}
          label="Classification"
        >
          <MenuItem value="all">All</MenuItem>
          {classificationsForDropdown.map((classification) => {
            const displayInfo = getClassificationDisplayInfo(classification);
            return (
              <MenuItem key={classification} value={classification}>
                {displayInfo.label}
              </MenuItem>
            );
          })}
        </Select>
      </FormControl>

      {/* Conclusion filter - aligned with Conclusion column */}
      <FormControl variant="outlined" size="small" fullWidth>
        <InputLabel>Conclusion</InputLabel>
        <Select
          value={conclusionFilter || 'all'}
          onChange={handleConclusionFilterChange}
          label="Conclusion"
        >
          <MenuItem value="all">All</MenuItem>
          {conclusionsForDropdown.map((conclusion) => (
            <MenuItem key={conclusion} value={conclusion}>
              {conclusion}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {/* Clear All + count - spans remaining columns (TestValue, ControlGroup, Difference, Actions) */}
      <Box
        sx={{
          gridColumn: 'span 4',
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          gap: 1,
          pr: 1,
        }}
      >
        <Button
          variant="outlined"
          size="small"
          startIcon={<FilterListOff />}
          onClick={onClearAllFilters}
          disabled={!hasActiveFilters}
        >
          Clear All
        </Button>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}
        >
          {filteredData.length}/{anomalyData.length}
        </Typography>
      </Box>
    </Box>
  );
}