'use client';

import Link from 'next/link';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Divider,
  CardActionArea,
} from '@mui/material';
import { ArrowForward } from '@mui/icons-material';

interface SettingsSectionCardProps {
  title: string;
  icon: React.ReactNode;
  color: string;
  comingSoon?: boolean;
  href?: string;
  description?: string;
}

export function SettingsSectionCard({
  title,
  icon,
  color,
  comingSoon = false,
  href,
  description,
}: SettingsSectionCardProps) {
  const cardContent = (
    <CardContent>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
        <Box
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 40,
            height: 40,
            borderRadius: '8px',
            background: `linear-gradient(135deg, ${color.replace('1)', '0.1)')} 0%, ${color.replace('1)', '0.05)')} 100%)`,
            color: color,
          }}
        >
          {icon}
        </Box>
        <Typography
          variant="h6"
          component="h2"
          sx={{ fontWeight: 600, color: 'text.primary', flex: 1 }}
        >
          {title}
        </Typography>
        {href && <ArrowForward sx={{ color: 'text.secondary', fontSize: 20 }} />}
      </Box>
      <Divider sx={{ mb: 3 }} />

      {comingSoon && (
        <Box sx={{ textAlign: 'center', py: 5 }}>
          <Box
            sx={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: `linear-gradient(135deg, ${color.replace('1)', '0.1)')} 0%, ${color.replace('1)', '0.05)')} 100%)`,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              mb: 2,
            }}
          >
            <Box sx={{ fontSize: 32, color: color, display: 'flex' }}>{icon}</Box>
          </Box>
          <Typography
            variant="subtitle1"
            sx={{ fontWeight: 600, color: 'text.primary', mb: 0.5 }}
          >
            Coming Soon
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {title} settings will be available in future updates.
          </Typography>
        </Box>
      )}

      {!comingSoon && description && (
        <Box sx={{ textAlign: 'center', py: 5 }}>
          <Box
            sx={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: `linear-gradient(135deg, ${color.replace('1)', '0.1)')} 0%, ${color.replace('1)', '0.05)')} 100%)`,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              mb: 2,
            }}
          >
            <Box sx={{ fontSize: 32, color: color, display: 'flex' }}>{icon}</Box>
          </Box>
          <Typography variant="body2" color="text.secondary">
            {description}
          </Typography>
        </Box>
      )}
    </CardContent>
  );

  return (
    <Card
      sx={{
        borderLeft: '4px solid',
        borderLeftColor: `${color.replace('1)', '0.8)')}`,
        boxShadow:
          '0 1px 3px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.24)',
        transition: 'all 0.3s cubic-bezier(.25,.8,.25,1)',
        '&:hover': {
          boxShadow:
            '0 4px 8px rgba(0, 0, 0, 0.15), 0 2px 4px rgba(0, 0, 0, 0.12)',
          transform: 'translateY(-2px)',
        },
      }}
    >
      {href ? (
        <CardActionArea component={Link} href={href}>
          {cardContent}
        </CardActionArea>
      ) : (
        cardContent
      )}
    </Card>
  );
}
