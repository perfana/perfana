import { Box, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';

interface PrimaryInfoBoxProps {
  label: string;
  value: string | React.ReactNode;
}

export default function PrimaryInfoBox({ label, value }: PrimaryInfoBoxProps) {
  return (
    <Box
      sx={(theme) => ({
        p: 2.5,
        textAlign: 'center',
        backgroundColor: alpha(theme.palette.primary.main, 0.06),
        border: `1.5px solid ${alpha(theme.palette.primary.main, 0.12)}`,
        borderRadius: 2,
        boxShadow: `0 1px 3px ${alpha(theme.palette.primary.main, 0.08)}`
      })}
    >
      <Typography
        variant="caption"
        sx={(theme) => ({
          display: 'block',
          fontSize: '0.8rem',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          color: alpha(theme.palette.primary.main, 0.8),
          mb: 1
        })}
      >
        {label}
      </Typography>
      {typeof value === 'string' ? (
        <Typography
          variant="body2"
          sx={(theme) => ({
            fontSize: '0.85rem',
            fontFamily: 'monospace',
            bgcolor: 'background.paper',
            border: `1px solid ${alpha(theme.palette.primary.main, 0.12)}`,
            borderRadius: 1,
            px: 1.5,
            py: 0.5,
            display: 'inline-block'
          })}
        >
          {value}
        </Typography>
      ) : (
        value
      )}
    </Box>
  );
}
