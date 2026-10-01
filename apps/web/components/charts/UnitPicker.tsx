'use client';

/**
 * The unit picker: a small popover of grouped chips, replacing the 220px MUI
 * Autocomplete that used to sit in every row of `GraphsSeriesList` /
 * `TrendsAddedSeriesList`.
 *
 * Chips rather than a dropdown because the whole set is 16 ids: a list that short is
 * faster to hit than it is to filter, and showing all of it is what makes the grouping
 * (time / percent / data / rate) readable in the first place.
 */

import React from 'react';
import { Box, Popover, Typography, IconButton } from '@mui/material';
import { Close } from '@mui/icons-material';
import { MONO, SIZE, UNIT_GROUPS, chartTheme, unitText, type ChartMode } from '@/lib/charts';

interface UnitPickerProps {
  anchorEl: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  mode: ChartMode;
  /** `Unit · {series name}`, or `Panel unit · {panel}` when Compare opens it for a panel. */
  title: string;
  /** The currently stored unit id. */
  value?: string;
  /** The panel's own unit — what `reset` goes back to. */
  panelUnit?: string;
  /** Where the panel unit came from, named in the footer. */
  panelSource?: string;
  onSelect: (unitId: string) => void;
}

export default function UnitPicker({
  anchorEl,
  open,
  onClose,
  mode,
  title,
  value,
  panelUnit,
  panelSource,
  onSelect,
}: UnitPickerProps) {
  const theme = chartTheme(mode);
  const overridden = !!panelUnit && value !== panelUnit;

  const pick = (unitId: string) => {
    onSelect(unitId);
    onClose();
  };

  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      slotProps={{
        paper: {
          sx: {
            width: 296,
            bgcolor: theme.paper,
            border: `1px solid ${theme.divider}`,
            borderRadius: `${SIZE.radius}px`,
            boxShadow: 'none',
            backgroundImage: 'none',
          },
        },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 0.75,
          borderBottom: `1px solid ${theme.divider}`,
        }}
      >
        <Typography
          sx={{ flex: 1, minWidth: 0, fontFamily: MONO, fontSize: 11, color: theme.text }}
          noWrap
          title={title}
        >
          {title}
        </Typography>
        <IconButton size="small" onClick={onClose} aria-label="Close unit picker" sx={{ color: theme.faint }}>
          <Close sx={{ fontSize: 14 }} />
        </IconButton>
      </Box>

      <Box sx={{ px: 1.5, py: 1, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        {UNIT_GROUPS.map((group) => (
          <Box key={group.label} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
            <Typography
              sx={{ width: 58, flexShrink: 0, pt: 0.4, fontFamily: MONO, fontSize: 10, color: theme.faint }}
            >
              {group.label}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {group.units.map((unit) => {
                const selected = unit.id === value;
                return (
                  <Box
                    key={unit.id}
                    component="button"
                    type="button"
                    title={unit.title}
                    aria-pressed={selected}
                    onClick={() => pick(unit.id)}
                    sx={{
                      height: 22,
                      px: 0.75,
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontFamily: MONO,
                      fontSize: 11,
                      fontWeight: selected ? 600 : 400,
                      color: selected ? theme.primary : theme.muted,
                      bgcolor: selected ? theme.selectedBg : 'transparent',
                      border: `1px solid ${selected ? theme.selectedBorder : theme.divider}`,
                      '&:hover': { bgcolor: selected ? theme.selectedBg : theme.hover },
                    }}
                  >
                    {unit.chip}
                  </Box>
                );
              })}
            </Box>
          </Box>
        ))}
      </Box>

      {panelUnit && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 1.5,
            py: 0.75,
            borderTop: `1px solid ${theme.divider}`,
            bgcolor: theme.plotBg,
          }}
        >
          <Typography sx={{ flex: 1, fontFamily: MONO, fontSize: 10, color: theme.faint }} noWrap>
            Panel unit{panelSource ? ` from ${panelSource}` : ''}: {unitText(panelUnit) || 'none'}
          </Typography>
          {overridden && (
            <Box
              component="button"
              type="button"
              onClick={() => pick(panelUnit)}
              sx={{
                border: 0,
                bgcolor: 'transparent',
                cursor: 'pointer',
                p: 0,
                fontFamily: MONO,
                fontSize: 10,
                fontWeight: 600,
                color: theme.primary,
              }}
            >
              reset to {unitText(panelUnit) || 'none'}
            </Box>
          )}
        </Box>
      )}
    </Popover>
  );
}
