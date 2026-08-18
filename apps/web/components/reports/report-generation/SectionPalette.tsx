'use client';

import { useMemo, useState } from 'react';
import {
  Box,
  IconButton,
  InputAdornment,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  ChevronLeft as CollapseIcon,
  ChevronRight as ExpandIcon,
  Search as SearchIcon,
} from '@mui/icons-material';
import { REPORT_SECTION_TYPES, type ReportSectionType } from '@/lib/api/reports';
import { SECTION_CONFIG } from './section-config';

export interface SectionPaletteProps {
  onAdd: (type: ReportSectionType) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** At the section cap: the catalogue still reads, but nothing can be added. */
  disabled?: boolean;
}

/**
 * The catalogue of section types you can add to a report.
 *
 * Deliberately small. This is a list you consult for seconds, next to a canvas you edit for
 * minutes, so it gives way rather than holding a fixed share of the dialog: one line per type
 * (all eleven fit without scrolling), the description on hover, and a collapse control that
 * hands the whole width to the canvas.
 *
 * There are no drag handles here. Adding is a click — the previous grip icons and "drag sections
 * to the canvas" copy described an interaction that was never wired up, so anyone who tried it
 * concluded the dialog was broken. Dragging still reorders sections once they are on the canvas.
 */
export function SectionPalette({ onAdd, collapsed, onToggleCollapsed, disabled }: SectionPaletteProps) {
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [search, setSearch] = useState('');

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return REPORT_SECTION_TYPES;
    return REPORT_SECTION_TYPES.filter((type) => {
      const { label, description } = SECTION_CONFIG[type];
      return label.toLowerCase().includes(q) || description.toLowerCase().includes(q);
    });
  }, [search]);

  const closeMenu = () => {
    setMenuAnchor(null);
    setSearch('');
  };

  const addAndClose = (type: ReportSectionType) => {
    onAdd(type);
    closeMenu();
  };

  if (collapsed) {
    return (
      <Box sx={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
        <Tooltip title="Show section list" placement="right">
          <IconButton size="small" onClick={onToggleCollapsed} aria-label="Show section list">
            <ExpandIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={disabled ? 'Section limit reached' : 'Add section'} placement="right">
          {/* span: a disabled button fires no events, so the tooltip needs a live wrapper */}
          <span>
            <IconButton
              size="small"
              color="primary"
              disabled={disabled}
              onClick={(e) => setMenuAnchor(e.currentTarget)}
              aria-label="Add section"
            >
              <AddIcon />
            </IconButton>
          </span>
        </Tooltip>

        <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
          <Box sx={{ px: 1.5, pt: 0.5, pb: 1 }}>
            <TextField
              autoFocus
              size="small"
              placeholder="Search sections"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              // Typing inside a Menu otherwise jumps focus to whichever item starts with that
              // letter, which makes the field impossible to use.
              onKeyDown={(e) => e.stopPropagation()}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
              sx={{ width: 260 }}
            />
          </Box>
          {matches.map((type) => (
            <MenuItem key={type} onClick={() => addAndClose(type)}>
              <ListItemIcon sx={{ color: SECTION_CONFIG[type].color }}>
                {SECTION_CONFIG[type].icon}
              </ListItemIcon>
              <ListItemText primary={SECTION_CONFIG[type].label} secondary={SECTION_CONFIG[type].description} />
            </MenuItem>
          ))}
          {matches.length === 0 && (
            <MenuItem disabled>
              <ListItemText primary={`No section matches "${search}"`} />
            </MenuItem>
          )}
        </Menu>
      </Box>
    );
  }

  return (
    // Shrinks before the canvas does: 0 1 300px yields width as the dialog narrows, where the
    // old 0 0 340px held its ground and squeezed the editing surface to nothing.
    <Box sx={{ flex: '0 1 300px', minWidth: 210, display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1, mb: 1.5 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" fontWeight={600}>
            Available Sections
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Click to add to your report
          </Typography>
        </Box>
        <Tooltip title="Hide section list">
          <IconButton size="small" onClick={onToggleCollapsed} aria-label="Hide section list">
            <CollapseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {REPORT_SECTION_TYPES.map((type) => {
          const config = SECTION_CONFIG[type];
          return (
            <Tooltip key={type} title={config.description} placement="right" enterDelay={400}>
              <Box
                component="button"
                type="button"
                disabled={disabled}
                onClick={() => onAdd(type)}
                aria-label={`Add ${config.label} section`}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.25,
                  width: '100%',
                  px: 1.25,
                  py: 1,
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1.5,
                  bgcolor: 'background.paper',
                  font: 'inherit',
                  textAlign: 'left',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  opacity: disabled ? 0.5 : 1,
                  transition: 'border-color 0.2s, background-color 0.2s',
                  '&:hover:not(:disabled)': { borderColor: 'primary.main', bgcolor: 'action.hover' },
                }}
              >
                <Box
                  sx={{
                    width: 26,
                    height: 26,
                    flexShrink: 0,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    bgcolor: `${config.color}15`,
                    color: config.color,
                    '& svg': { fontSize: 16 },
                  }}
                >
                  {config.icon}
                </Box>
                <Typography variant="body2" fontWeight={500} noWrap sx={{ minWidth: 0 }}>
                  {config.label}
                </Typography>
              </Box>
            </Tooltip>
          );
        })}
      </Box>
    </Box>
  );
}
