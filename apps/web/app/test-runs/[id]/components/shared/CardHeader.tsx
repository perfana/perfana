import { Box, Typography, IconButton } from '@mui/material';
import { ExpandMore, ExpandLess } from '@mui/icons-material';

interface CardHeaderProps {
  title: string;
  expanded: boolean;
  onExpand: () => void;
  additionalActions?: React.ReactNode;
}

export default function CardHeader({ title, expanded, onExpand, additionalActions }: CardHeaderProps) {
  return (
    <Box
      display="flex"
      justifyContent="space-between"
      alignItems="center"
      sx={{
        cursor: expanded ? 'pointer' : 'inherit',
        py: 1,
        px: 1,
        mx: -1,
        borderRadius: 2,
        transition: 'background-color 0.2s ease',
        position: 'relative',
        gap: 2,
        '&:hover': expanded ? {
          backgroundColor: 'action.hover'
        } : {}
      }}
      onClick={expanded ? onExpand : undefined}
    >
      {additionalActions && (
        <Box display="flex" alignItems="center" gap={1.5} flexShrink={0}>
          {additionalActions}
        </Box>
      )}
      <Box textAlign="center" flex="1">
        <Typography
          variant="h5"
          component="h2"
          sx={{
            fontWeight: expanded ? 600 : 700,
            color: expanded ? 'text.primary' : 'primary.dark',
            fontSize: expanded ? '1.125rem' : '1.25rem',
            letterSpacing: expanded ? 'normal' : '-0.01em',
            lineHeight: 1.2
          }}
        >
          {title}
        </Typography>
        {expanded && (
          <Typography variant="body2" color="text.secondary">
            Click to collapse
          </Typography>
        )}
      </Box>
      <IconButton
        onClick={(e) => {
          e.stopPropagation();
          onExpand();
        }}
        size="small"
        sx={{
          position: 'absolute',
          right: 0,
          width: 36,
          height: 36,
          backgroundColor: 'rgba(25, 118, 210, 0.08)',
          color: 'primary.main',
          transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          boxShadow: '0 2px 6px rgba(25, 118, 210, 0.15)',
          '&:hover': {
            backgroundColor: 'primary.main',
            color: 'primary.contrastText',
            transform: 'scale(1.1)',
            boxShadow: '0 4px 12px rgba(25, 118, 210, 0.3)'
          }
        }}
      >
        {expanded ? <ExpandLess /> : <ExpandMore />}
      </IconButton>
    </Box>
  );
}
