'use client';

import { Box, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';

const HEADER_COLUMNS = [
  { label: '', width: '40px' },
  { label: 'Dashboard', width: 'minmax(200px, 1fr)' },
  { label: 'Panel', width: 'minmax(180px, 1fr)' },
  { label: 'Metric', width: 'minmax(160px, 1fr)' },
  { label: 'Classification', width: 'minmax(120px, 0.8fr)' },
  { label: 'Conclusion', width: 'minmax(100px, 0.7fr)' },
  { label: 'Test Value', width: 'minmax(100px, 0.6fr)' },
  { label: 'Control Group', width: 'minmax(100px, 0.6fr)' },
  { label: 'Difference', width: 'minmax(120px, 0.7fr)' },
  { label: 'Actions', width: '50px', textAlign: 'center' as const },
];

const headerStyles = {
  fontWeight: 700,
  color: 'primary.dark',
  fontSize: '0.85rem',
  letterSpacing: '0.5px',
  textTransform: 'uppercase' as const,
};

export function AnomalyTableHeader() {
  return (
    <Box sx={(theme) => ({
      display: 'grid',
      gridTemplateColumns: '40px minmax(200px, 1fr) minmax(180px, 1fr) minmax(160px, 1fr) minmax(120px, 0.8fr) minmax(100px, 0.7fr) minmax(100px, 0.6fr) minmax(100px, 0.6fr) minmax(120px, 0.7fr) 50px',
      gap: 1,
      px: 2,
      py: 2,
      background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.08)} 0%, ${alpha(theme.palette.primary.main, 0.06)} 50%, ${alpha(theme.palette.primary.main, 0.04)} 100%)`,
      borderRadius: '8px 8px 0 0',
      border: '1px solid',
      borderColor: alpha(theme.palette.primary.main, 0.15),
      borderBottom: 'none',
      boxShadow: `0 1px 3px ${alpha(theme.palette.text.primary, 0.08)}`,
      backdropFilter: 'blur(8px)',
      minWidth: '1000px'
    })}>
      <Box />
      {HEADER_COLUMNS.slice(1).map((col) => (
        <Typography
          key={col.label}
          variant="subtitle2"
          sx={{
            ...headerStyles,
            textAlign: col.textAlign || 'left',
          }}
        >
          {col.label}
        </Typography>
      ))}
    </Box>
  );
}
