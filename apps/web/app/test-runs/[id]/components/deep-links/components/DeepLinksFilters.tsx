'use client';

import { Box, TextField, Chip, IconButton, Typography } from '@mui/material';
import { Close } from '@mui/icons-material';

interface DeepLinksFiltersProps {
  searchText: string;
  onSearchChange: (value: string) => void;
  /** All unique tags across the current resolved links */
  availableTags: string[];
  /** Currently active tags (OR filter) */
  activeTags: string[];
  onTagToggle: (tag: string) => void;
  /** Total and filtered counts for summary text */
  totalCount?: number;
  filteredCount?: number;
}

export function DeepLinksFilters({
  searchText,
  onSearchChange,
  availableTags,
  activeTags,
  onTagToggle,
  totalCount,
  filteredCount,
}: DeepLinksFiltersProps) {
  if (availableTags.length === 0 && searchText === '') {
    return null;
  }

  const hasActiveFilters = activeTags.length > 0 || searchText.length > 0;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mb: 3 }}>
      {/* Search */}
      <Box>
        <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 600 }}>
          Search Deep Links
        </Typography>
        <TextField
          fullWidth
          size="small"
          placeholder="Search deep links by name or URL..."
          value={searchText}
          onChange={(e) => onSearchChange(e.target.value)}
          InputProps={{
            endAdornment: searchText && (
              <IconButton
                size="small"
                onClick={() => onSearchChange('')}
                sx={{ mr: -1 }}
              >
                <Close fontSize="small" />
              </IconButton>
            ),
          }}
        />
      </Box>

      {/* Tag filter chips */}
      {availableTags.length > 0 && (
        <Box>
          <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 600 }}>
            Filter by Tags
          </Typography>
          <Box display="flex" flexWrap="wrap" gap={1}>
            {availableTags.map((tag) => {
              const active = activeTags.includes(tag);
              return (
                <Chip
                  key={tag}
                  label={tag}
                  clickable
                  onClick={() => onTagToggle(tag)}
                  sx={{
                    height: '32px',
                    fontWeight: 600,
                    backdropFilter: 'blur(8px)',
                    transition: 'all 0.2s ease',
                    background: (theme) =>
                      active
                        ? theme.palette.mode === 'dark'
                          ? 'linear-gradient(135deg, rgba(100, 181, 246, 0.20) 0%, rgba(66, 165, 245, 0.28) 100%)'
                          : 'linear-gradient(135deg, rgba(25, 118, 210, 0.08) 0%, rgba(30, 136, 229, 0.12) 100%)'
                        : theme.palette.mode === 'dark'
                          ? 'linear-gradient(135deg, rgba(206, 147, 216, 0.15) 0%, rgba(186, 104, 200, 0.22) 100%)'
                          : 'linear-gradient(135deg, rgba(156, 39, 176, 0.08) 0%, rgba(171, 71, 188, 0.12) 100%)',
                    border: (theme) =>
                      active
                        ? theme.palette.mode === 'dark'
                          ? '1px solid rgba(100, 181, 246, 0.5)'
                          : '1px solid rgba(25, 118, 210, 0.3)'
                        : theme.palette.mode === 'dark'
                          ? '1px solid rgba(206, 147, 216, 0.4)'
                          : '1px solid rgba(156, 39, 176, 0.3)',
                    color: (theme) =>
                      active
                        ? theme.palette.mode === 'dark' ? '#90caf9' : theme.palette.primary.dark
                        : theme.palette.mode === 'dark' ? '#ce93d8' : '#9c27b0',
                    '&:hover': {
                      transform: 'translateY(-1px)',
                      boxShadow: (theme) =>
                        active
                          ? theme.palette.mode === 'dark'
                            ? '0 4px 12px rgba(100, 181, 246, 0.3)'
                            : '0 4px 12px rgba(25, 118, 210, 0.2)'
                          : theme.palette.mode === 'dark'
                            ? '0 4px 12px rgba(206, 147, 216, 0.3)'
                            : '0 4px 12px rgba(156, 39, 176, 0.2)',
                      border: (theme) =>
                        active
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
          {hasActiveFilters && totalCount !== undefined && filteredCount !== undefined && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              Showing {filteredCount} of {totalCount} deep links
              {searchText && ` matching "${searchText}"`}
              {activeTags.length > 0 && ` with tags: ${activeTags.join(', ')}`}
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}
