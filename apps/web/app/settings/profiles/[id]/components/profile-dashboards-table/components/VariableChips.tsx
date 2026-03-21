'use client';

import { Box, Typography, Chip, Tooltip } from '@mui/material';
import { DashboardVariable } from '@/lib/profiles';
import { PURPLE_CHIP_SX, BLUE_CHIP_SX, GREEN_CHIP_SX, truncateLabel } from '../utils';

interface SeparateDashboardChipProps {
  value?: string;
}

/**
 * Chip component for the "Separate Dashboard For" column
 */
export function SeparateDashboardChip({ value }: SeparateDashboardChipProps) {
  if (!value) {
    return (
      <Typography variant="body2" color="text.secondary">
        -
      </Typography>
    );
  }

  return (
    <Tooltip title="Variable used to create separate dashboard instances">
      <Chip label={value} size="small" sx={PURPLE_CHIP_SX} />
    </Tooltip>
  );
}

interface HardcodedVariablesChipsProps {
  variables?: DashboardVariable[];
}

/**
 * Chips component for displaying hardcoded variables
 */
export function HardcodedVariablesChips({ variables }: HardcodedVariablesChipsProps) {
  if (!variables || variables.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        -
      </Typography>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
      {variables.map((variable, index) => {
        const displayLabel = `${variable.name}: ${variable.values.join(', ')}`;
        const isLong = displayLabel.length > 30;

        return (
          <Tooltip
            key={index}
            title={
              isLong ? (
                <Box>
                  <Typography variant="caption" fontWeight="bold" display="block">
                    {variable.name}
                  </Typography>
                  <Typography variant="caption" display="block">
                    Values: {variable.values.join(', ')}
                  </Typography>
                </Box>
              ) : ''
            }
          >
            <Chip
              label={truncateLabel(displayLabel)}
              size="small"
              sx={BLUE_CHIP_SX}
            />
          </Tooltip>
        );
      })}
    </Box>
  );
}

interface RegexRulesChipsProps {
  rules?: Record<string, string>;
}

/**
 * Chips component for displaying regex rules
 */
export function RegexRulesChips({ rules }: RegexRulesChipsProps) {
  if (!rules || Object.keys(rules).length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        -
      </Typography>
    );
  }

  const entries = Object.entries(rules);

  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
      {entries.map(([varName, regex], index) => {
        const displayLabel = `${varName}: ${regex}`;

        return (
          <Tooltip
            key={index}
            title={
              <Box>
                <Typography variant="caption" fontWeight="bold" display="block">
                  Variable: {varName}
                </Typography>
                <Typography variant="caption" display="block" sx={{ fontFamily: 'monospace' }}>
                  Pattern: {regex}
                </Typography>
              </Box>
            }
          >
            <Chip
              label={truncateLabel(displayLabel)}
              size="small"
              sx={GREEN_CHIP_SX}
            />
          </Tooltip>
        );
      })}
    </Box>
  );
}

interface TagsChipsProps {
  tags: string[];
}

/**
 * Chips component for displaying filtered tags
 */
export function TagsChips({ tags }: TagsChipsProps) {
  if (tags.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        -
      </Typography>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
      {tags.map((tag, index) => (
        <Chip key={index} label={tag} size="small" sx={BLUE_CHIP_SX} />
      ))}
    </Box>
  );
}
