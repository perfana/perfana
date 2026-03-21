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
  Business,
  Group,
  ArrowForward,
  Settings,
} from '@mui/icons-material';
import { Organization } from '@/lib/api/organizations';

interface OrganizationCardProps {
  organization: Organization;
  memberCount?: number;
  teamCount?: number;
  isSelected?: boolean;
  onSelect?: () => void;
  onViewDetails?: () => void;
}

export function OrganizationCard({
  organization,
  memberCount = 0,
  teamCount = 0,
  isSelected = false,
  onSelect,
  onViewDetails,
}: OrganizationCardProps) {
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
          ? 'primary.main'
          : 'rgba(25, 118, 210, 0.3)',
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
                'linear-gradient(135deg, rgba(25, 118, 210, 0.1) 0%, rgba(25, 118, 210, 0.05) 100%)',
              color: 'primary.main',
            }}
          >
            <Business />
          </Box>
          <Box sx={{ flexGrow: 1 }}>
            <Typography
              variant="h6"
              component="h3"
              sx={{ fontWeight: 600, color: 'text.primary' }}
            >
              {organization.name}
            </Typography>
            {isSelected && (
              <Chip
                label="Current"
                size="small"
                color="primary"
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

        {/* Description */}
        {organization.description && (
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
            {organization.description}
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
          <Box display="flex" alignItems="center" gap={0.5}>
            <Business fontSize="small" sx={{ color: 'text.secondary' }} />
            <Typography variant="body2" color="text.secondary">
              {teamCount} {teamCount === 1 ? 'team' : 'teams'}
            </Typography>
          </Box>
        </Box>

        {/* Created date */}
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', mt: 2 }}
        >
          Created: {formatDate(organization.created_at)}
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
