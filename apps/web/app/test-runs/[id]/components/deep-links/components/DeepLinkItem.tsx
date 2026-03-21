'use client';

import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Chip,
  Tooltip,
} from '@mui/material';
import {
  Link as LinkIcon,
  OpenInNew,
  Visibility,
  WarningAmber,
} from '@mui/icons-material';
import { ResolvedDeepLink } from '../types';

interface DeepLinkItemProps {
  link: ResolvedDeepLink;
  onPreview: (link: ResolvedDeepLink) => void;
  onOpenInNewTab: (link: ResolvedDeepLink) => void;
}

export function DeepLinkItem({ link, onPreview, onOpenInNewTab }: DeepLinkItemProps) {
  return (
    <Card
      variant="outlined"
      sx={{
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        opacity: link.isValid ? 1 : 0.75,
        transition: 'all 0.2s ease',
        '&:hover': link.isValid
          ? { boxShadow: 2, borderColor: 'primary.main' }
          : { boxShadow: 1, borderColor: 'warning.main' },
      }}
    >
      <CardContent sx={{ flexGrow: 1, pb: 1 }}>
        {/* Header row: icon + name + warning badge */}
        <Box display="flex" alignItems="flex-start" gap={1} mb={0.5}>
          <LinkIcon
            sx={{ color: link.isValid ? 'primary.main' : 'warning.main', mt: '2px', flexShrink: 0 }}
            fontSize="small"
          />
          {/* Name with URL shown as tooltip — keeps the card compact */}
          <Tooltip
            title={
              <Box>
                <Typography variant="caption" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  {link.url}
                </Typography>
                {!link.isValid && link.unresolvedVariables && (
                  <Typography variant="caption" color="warning.light" display="block" mt={0.5}>
                    Unresolved: {link.unresolvedVariables.join(', ')}
                  </Typography>
                )}
              </Box>
            }
            placement="top"
            arrow
          >
            <Typography
              variant="subtitle2"
              sx={{
                fontWeight: 600,
                flexGrow: 1,
                cursor: 'default',
                // Subtle underline hint that there's more info on hover
                textDecoration: 'underline dotted',
                textDecorationColor: 'text.disabled',
                textUnderlineOffset: '3px',
              }}
            >
              {link.name}
            </Typography>
          </Tooltip>

          {/* Tag chips */}
          {link.tags?.length > 0 && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.75 }}>
              {link.tags.map((tag) => (
                <Chip
                  key={tag}
                  label={tag}
                  size="small"
                  sx={{
                    height: 18,
                    fontSize: '0.65rem',
                    background: (theme) =>
                      theme.palette.mode === 'dark'
                        ? 'linear-gradient(135deg, rgba(100,181,246,0.15) 0%, rgba(66,165,245,0.20) 100%)'
                        : 'linear-gradient(135deg, rgba(25,118,210,0.08) 0%, rgba(30,136,229,0.12) 100%)',
                    border: (theme) =>
                      theme.palette.mode === 'dark'
                        ? '1px solid rgba(100,181,246,0.4)'
                        : '1px solid rgba(25,118,210,0.3)',
                    color: (theme) =>
                      theme.palette.mode === 'dark' ? '#90caf9' : theme.palette.primary.dark,
                    '& .MuiChip-label': { px: 0.5 },
                  }}
                />
              ))}
            </Box>
          )}

          {/* Warning chip for unresolved variables */}
          {!link.isValid && (
            <Tooltip title={`Unresolved: ${link.unresolvedVariables?.join(', ')}`} arrow>
              <Chip
                icon={<WarningAmber sx={{ fontSize: '14px !important' }} />}
                label="Unresolved"
                size="small"
                color="warning"
                variant="outlined"
                sx={{ height: 20, fontSize: '0.65rem', flexShrink: 0, '& .MuiChip-label': { px: 0.75 } }}
              />
            </Tooltip>
          )}
        </Box>
      </CardContent>

      {/* Action buttons — same two-button pattern as DashboardCard */}
      <Box sx={{ px: 2, pb: 2, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        <Tooltip title={link.isValid ? 'Preview in modal' : 'Cannot preview — URL has unresolved variables'} arrow>
          <span style={{ display: 'block' }}>
            <Button
              variant="contained"
              size="small"
              fullWidth
              startIcon={<Visibility />}
              onClick={() => onPreview(link)}
              disabled={!link.isValid}
            >
              Preview
            </Button>
          </span>
        </Tooltip>

        <Tooltip title={link.isValid ? 'Open in new tab' : 'Cannot open — URL has unresolved variables'} arrow>
          <span style={{ display: 'block' }}>
            <Button
              variant="outlined"
              size="small"
              fullWidth
              startIcon={<OpenInNew />}
              onClick={() => onOpenInNewTab(link)}
              disabled={!link.isValid}
            >
              Open
            </Button>
          </span>
        </Tooltip>
      </Box>
    </Card>
  );
}
