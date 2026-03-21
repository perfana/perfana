'use client';

import {
  Box,
  Typography,
  Card,
  CardContent,
  CardActions,
  Button,
  Chip,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  Groups,
  Group,
  ArrowForward,
  Settings,
} from '@mui/icons-material';
import { Team } from '@/lib/api/teams';

interface TeamCardProps {
  team: Team;
  memberCount?: number;
  organizationName?: string;
  isSelected?: boolean;
  onSelect?: () => void;
  onViewDetails?: () => void;
}

export function TeamCard({
  team,
  memberCount = 0,
  organizationName,
  isSelected = false,
  onSelect,
  onViewDetails,
}: TeamCardProps) {
  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'N/A';
    return date.toLocaleDateString();
  };

  return (
    <Card
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderLeft: '4px solid',
        borderLeftColor: isSelected
          ? 'secondary.main'
          : 'rgba(156, 39, 176, 0.3)',
        boxShadow:
          '0 1px 3px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.24)',
        transition: 'all 0.3s cubic-bezier(.25,.8,.25,1)',
        cursor: onSelect ? 'pointer' : 'default',
        '&:hover': {
          boxShadow:
            '0 4px 8px rgba(0, 0, 0, 0.15), 0 2px 4px rgba(0, 0, 0, 0.12)',
          transform: 'translateY(-2px)',
        },
      }}
      onClick={onSelect}
    >
      <CardContent sx={{ flexGrow: 1 }}>
        {/* Header */}
        <Box display="flex" alignItems="center" gap={1.5} mb={2}>
          <Box
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 40,
              height: 40,
              borderRadius: '8px',
              background:
                'linear-gradient(135deg, rgba(156, 39, 176, 0.1) 0%, rgba(156, 39, 176, 0.05) 100%)',
              color: 'secondary.main',
            }}
          >
            <Groups />
          </Box>
          <Box sx={{ flexGrow: 1 }}>
            <Typography
              variant="h6"
              component="h3"
              sx={{ fontWeight: 600, color: 'text.primary' }}
            >
              {team.name}
            </Typography>
            {isSelected && (
              <Chip
                label="Current"
                size="small"
                color="secondary"
                sx={{ mt: 0.5, fontWeight: 600 }}
              />
            )}
          </Box>
          {onViewDetails && (
            <Tooltip title="Settings">
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  onViewDetails();
                }}
              >
                <Settings fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Box>

        {/* Organization Name */}
        {organizationName && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              display: 'block',
              mb: 1,
              fontStyle: 'italic',
            }}
          >
            Organization: {organizationName}
          </Typography>
        )}

        {/* Description */}
        {team.description && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              mb: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
            }}
          >
            {team.description}
          </Typography>
        )}

        {/* Stats */}
        <Box display="flex" gap={2} mt={2}>
          <Box display="flex" alignItems="center" gap={0.5}>
            <Group fontSize="small" sx={{ color: 'text.secondary' }} />
            <Typography variant="body2" color="text.secondary">
              {memberCount} {memberCount === 1 ? 'member' : 'members'}
            </Typography>
          </Box>
        </Box>

        {/* Created date */}
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', mt: 2 }}
        >
          Created: {formatDate(team.created_at)}
        </Typography>
      </CardContent>

      {onViewDetails && (
        <CardActions sx={{ px: 2, pb: 2, pt: 0 }}>
          <Button
            size="small"
            endIcon={<ArrowForward />}
            onClick={(e) => {
              e.stopPropagation();
              onViewDetails();
            }}
            sx={{ textTransform: 'none' }}
          >
            View Details
          </Button>
        </CardActions>
      )}
    </Card>
  );
}
