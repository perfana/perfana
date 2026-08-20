'use client';

import { RefObject } from 'react';
import {
  Popper,
  Paper,
  MenuList,
  MenuItem,
  Typography,
} from '@mui/material';
import { VariableDefinition } from '../types';

interface AutocompletePopperProps {
  open: boolean;
  anchorEl: HTMLElement | null;
  variables: VariableDefinition[];
  selectedIndex: number;
  hoveredIndex: number | null;
  onSelect: (variable: VariableDefinition) => void;
  onHover: (index: number | null) => void;
  menuListRef: RefObject<HTMLUListElement | null>;
}

export function AutocompletePopper({
  open,
  anchorEl,
  variables,
  selectedIndex,
  hoveredIndex,
  onSelect,
  onHover,
  menuListRef,
}: AutocompletePopperProps) {
  if (!open || variables.length === 0) return null;

  return (
    <Popper
      open={open}
      anchorEl={anchorEl}
      placement="bottom-start"
      style={{ zIndex: 1400, minWidth: 300 }}
    >
      <Paper elevation={8} sx={{ maxHeight: 200, overflow: 'auto' }}>
        <MenuList dense ref={menuListRef as React.RefObject<HTMLUListElement>}>
          {variables.map((variable, index) => {
            const isSelected = index === selectedIndex;
            const isHovered = index === hoveredIndex;
            const isHighlighted = isSelected || isHovered;

            return (
              <MenuItem
                key={variable.name}
                onClick={() => onSelect(variable)}
                selected={isSelected}
                onMouseEnter={() => onHover(index)}
                onMouseLeave={() => onHover(null)}
                sx={{
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  py: 1,
                  '&:hover': {
                    backgroundColor: 'primary.main',
                  },
                  '&.Mui-selected': {
                    backgroundColor: 'primary.main',
                    '&:hover': {
                      backgroundColor: 'primary.dark',
                    },
                  },
                }}
              >
                <Typography
                  variant="body2"
                  sx={{
                    fontFamily: 'monospace',
                    fontWeight: 'medium',
                    color: isHighlighted ? 'white' : 'text.primary',
                  }}
                >
                  {`{${variable.name}}`}
                </Typography>
                <Typography
                  variant="caption"
                  sx={{
                    color: isHighlighted ? 'white' : 'text.secondary',
                  }}
                >
                  {variable.description}
                </Typography>
                {variable.example && (
                  <Typography
                    variant="caption"
                    sx={{
                      fontFamily: 'monospace',
                      color: isHighlighted ? 'rgba(255,255,255,0.85)' : 'text.disabled',
                    }}
                  >
                    e.g. {variable.example}
                  </Typography>
                )}
              </MenuItem>
            );
          })}
        </MenuList>
      </Paper>
    </Popper>
  );
}
