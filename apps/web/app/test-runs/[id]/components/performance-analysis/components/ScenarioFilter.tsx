'use client';

import { Box, Typography, Chip } from '@mui/material';

export const NO_SCENARIO_LABEL = 'No Scenario';

interface ScenarioFilterProps {
  availableScenarios: string[];
  selectedScenarios: string[];
  onToggle: (scenario: string) => void;
  totalItems?: number;
  filteredItems?: number;
}

export function ScenarioFilter({
  availableScenarios,
  selectedScenarios,
  onToggle,
  totalItems,
  filteredItems,
}: ScenarioFilterProps) {
  if (availableScenarios.length === 0) return null;

  const showFilteredCaption =
    selectedScenarios.length > 0 &&
    typeof totalItems === 'number' &&
    typeof filteredItems === 'number';

  return (
    <Box mb={2}>
      <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 600 }}>
        Filter by Scenario
      </Typography>
      <Box display="flex" flexWrap="wrap" gap={1}>
        {availableScenarios.map((scenario) => {
          const selected = selectedScenarios.includes(scenario);
          return (
            <Chip
              key={scenario}
              label={scenario}
              clickable
              onClick={() => onToggle(scenario)}
              sx={{
                height: '32px',
                fontWeight: 600,
                backdropFilter: 'blur(8px)',
                transition: 'all 0.2s ease',
                background: (theme) =>
                  selected
                    ? theme.palette.mode === 'dark'
                      ? 'linear-gradient(135deg, rgba(100, 181, 246, 0.20) 0%, rgba(66, 165, 245, 0.28) 100%)'
                      : 'linear-gradient(135deg, rgba(25, 118, 210, 0.08) 0%, rgba(30, 136, 229, 0.12) 100%)'
                    : theme.palette.mode === 'dark'
                      ? 'linear-gradient(135deg, rgba(206, 147, 216, 0.15) 0%, rgba(186, 104, 200, 0.22) 100%)'
                      : 'linear-gradient(135deg, rgba(156, 39, 176, 0.08) 0%, rgba(171, 71, 188, 0.12) 100%)',
                border: (theme) =>
                  selected
                    ? theme.palette.mode === 'dark'
                      ? '1px solid rgba(100, 181, 246, 0.5)'
                      : '1px solid rgba(25, 118, 210, 0.3)'
                    : theme.palette.mode === 'dark'
                      ? '1px solid rgba(206, 147, 216, 0.4)'
                      : '1px solid rgba(156, 39, 176, 0.3)',
                color: (theme) =>
                  selected
                    ? theme.palette.mode === 'dark' ? '#90caf9' : theme.palette.primary.dark
                    : theme.palette.mode === 'dark' ? '#ce93d8' : '#9c27b0',
                '&:hover': {
                  transform: 'translateY(-1px)',
                  boxShadow: (theme) =>
                    selected
                      ? theme.palette.mode === 'dark'
                        ? '0 4px 12px rgba(100, 181, 246, 0.3)'
                        : '0 4px 12px rgba(25, 118, 210, 0.2)'
                      : theme.palette.mode === 'dark'
                        ? '0 4px 12px rgba(206, 147, 216, 0.3)'
                        : '0 4px 12px rgba(156, 39, 176, 0.2)',
                  border: (theme) =>
                    selected
                      ? theme.palette.mode === 'dark'
                        ? '1px solid rgba(100, 181, 246, 0.7)'
                        : '1px solid rgba(25, 118, 210, 0.5)'
                      : theme.palette.mode === 'dark'
                        ? '1px solid rgba(206, 147, 216, 0.6)'
                        : '1px solid rgba(156, 39, 176, 0.5)',
                },
                '& .MuiChip-label': {
                  px: 1.5,
                  py: 0,
                  fontSize: '0.8rem',
                },
              }}
            />
          );
        })}
      </Box>
      {showFilteredCaption && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          Showing {filteredItems} of {totalItems} — scenarios: {selectedScenarios.join(', ')}
        </Typography>
      )}
    </Box>
  );
}
