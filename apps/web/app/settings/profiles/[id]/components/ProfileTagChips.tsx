import { Box, Typography, Chip } from '@mui/material';
import { Lock } from '@mui/icons-material';

interface ProfileTagChipsProps {
  tags?: string[];
  readOnly?: boolean;
}

const PROVISIONED_CHIP_SX = {
  height: '28px',
  background: 'linear-gradient(135deg, rgba(255, 193, 7, 0.1) 0%, rgba(255, 193, 7, 0.2) 100%)',
  border: '1px solid rgba(255, 193, 7, 0.3)',
  color: '#f57f17',
  fontWeight: 600,
  '& .MuiChip-icon': { color: 'rgba(255, 193, 7, 0.7)', marginLeft: '4px' },
  '&:hover': { transform: 'translateY(-1px)', boxShadow: '0 4px 12px rgba(255, 193, 7, 0.3)' },
  '& .MuiChip-label': { px: 1.5, fontSize: '0.75rem' },
};

const TAG_CHIP_SX = {
  height: '28px',
  background: 'linear-gradient(135deg, rgba(25, 118, 210, 0.1) 0%, rgba(25, 118, 210, 0.2) 100%)',
  border: '1px solid rgba(25, 118, 210, 0.3)',
  color: 'primary.dark',
  fontWeight: 600,
  '&:hover': { transform: 'translateY(-1px)', boxShadow: '0 4px 12px rgba(25, 118, 210, 0.2)' },
  '& .MuiChip-label': { px: 1.5, fontSize: '0.75rem' },
};

/**
 * Filters out system tags that should not be displayed to users
 */
function filterSystemTags(tags: string[] | undefined): string[] {
  if (!tags) return [];
  return tags.filter(tag => tag !== 'perfana' && tag !== 'perfana-template' && tag !== 'no-anomaly-detection');
}

/**
 * Component for displaying profile tags with styling
 */
export function ProfileTagChips({ tags, readOnly }: ProfileTagChipsProps) {
  const filteredTags = filterSystemTags(tags);

  return (
    <Box display="flex" gap={0.5} flexWrap="wrap">
      {readOnly && (
        <Chip icon={<Lock fontSize="small" />} label="Provisioned" size="small" sx={PROVISIONED_CHIP_SX} />
      )}
      {filteredTags.length > 0 ? (
        filteredTags.map((tag, index) => (
          <Chip key={index} label={tag} size="small" sx={TAG_CHIP_SX} />
        ))
      ) : !readOnly ? (
        <Typography variant="caption" color="text.secondary">No tags</Typography>
      ) : null}
    </Box>
  );
}
