'use client';

import {
  Box,
  Typography,
  Card,
  CardContent,
  Divider,
  TextField,
  Button,
  IconButton,
  Tooltip,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Alert,
  Chip,
} from '@mui/material';
import {
  Add,
  ContentCopy,
  Delete,
  AccessTime,
  CheckCircle,
  Error as ErrorIcon,
  VpnKey,
} from '@mui/icons-material';
import { ApiKey } from '@/lib/api-keys';
import { SECTION_COLORS } from '../types';

interface ApiKeyCardProps {
  apiKeys: ApiKey[];
  error: string;
  createdToken: string;
  onCreateClick: () => void;
  onDeleteClick: (apiKey: ApiKey) => void;
  onClearCreatedToken: () => void;
  onCopyToClipboard: (text: string) => Promise<void>;
}

// Utility functions
const formatDate = (dateString: string | undefined): string => {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return 'N/A';
  return date.toLocaleString();
};

const isExpired = (validUntil: string | undefined): boolean => {
  if (!validUntil) return false;
  const date = new Date(validUntil);
  if (isNaN(date.getTime())) return false;
  return date <= new Date();
};

const getDaysUntilExpiry = (validUntil: string | undefined): number => {
  if (!validUntil) return 0;
  const now = new Date();
  const expiry = new Date(validUntil);
  if (isNaN(expiry.getTime())) return 0;
  const diffTime = expiry.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
};

const getStatusChip = (apiKey: ApiKey) => {
  const expired = isExpired(apiKey.valid_until);

  if (expired) {
    return (
      <Chip
        icon={<ErrorIcon sx={{ color: 'white !important' }} />}
        label="Expired"
        size="small"
        sx={{
          background: 'linear-gradient(135deg, #f44336 0%, #ef5350 100%)',
          color: 'white',
          fontWeight: 600,
          boxShadow: '0 2px 8px rgba(244, 67, 54, 0.3)',
          border: 'none',
        }}
      />
    );
  }

  return (
    <Chip
      icon={<CheckCircle sx={{ color: 'white !important' }} />}
      label="Active"
      size="small"
      sx={{
        background: 'linear-gradient(135deg, #4caf50 0%, #66bb6a 100%)',
        color: 'white',
        fontWeight: 600,
        boxShadow: '0 2px 8px rgba(76, 175, 80, 0.3)',
        border: 'none',
      }}
    />
  );
};

export function ApiKeyCard({
  apiKeys,
  error,
  createdToken,
  onCreateClick,
  onDeleteClick,
  onClearCreatedToken,
  onCopyToClipboard,
}: ApiKeyCardProps) {
  const primaryColor = SECTION_COLORS['api-keys'];

  return (
    <Card
      sx={{
        borderLeft: '4px solid',
        borderLeftColor: 'rgba(25, 118, 210, 0.8)',
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
      <CardContent>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 40,
                height: 40,
                borderRadius: '8px',
                background: `linear-gradient(135deg, rgba(25, 118, 210, 0.1) 0%, rgba(25, 118, 210, 0.05) 100%)`,
                color: primaryColor,
              }}
            >
              <VpnKey />
            </Box>
            <Typography
              variant="h6"
              component="h2"
              sx={{ fontWeight: 600, color: 'text.primary' }}
            >
              API Keys
            </Typography>
          </Box>
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={onCreateClick}
            sx={{
              background: `linear-gradient(135deg, ${primaryColor} 0%, rgba(30, 136, 229, 1) 100%)`,
              boxShadow: '0 2px 8px rgba(25, 118, 210, 0.3)',
              textTransform: 'none',
              fontWeight: 600,
              '&:hover': {
                background:
                  'linear-gradient(135deg, rgba(21, 101, 192, 1) 0%, rgba(25, 118, 210, 1) 100%)',
                boxShadow: '0 4px 12px rgba(25, 118, 210, 0.4)',
                transform: 'translateY(-1px)',
              },
            }}
          >
            Create API Key
          </Button>
        </Box>

        <Divider sx={{ mb: 2 }} />

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {createdToken && (
          <Alert severity="success" sx={{ mb: 2 }} onClose={onClearCreatedToken}>
            <Typography variant="body2" gutterBottom>
              <strong>
                Your new API key has been created. Copy it now - you won&apos;t be able to
                see it again!
              </strong>
            </Typography>
            <Box display="flex" alignItems="center" gap={1} mt={1}>
              <TextField
                value={createdToken}
                variant="outlined"
                size="small"
                fullWidth
                InputProps={{
                  readOnly: true,
                  sx: { fontFamily: 'monospace' },
                }}
              />
              <Tooltip title="Copy to clipboard">
                <IconButton
                  onClick={() => onCopyToClipboard(createdToken)}
                  color="primary"
                >
                  <ContentCopy />
                </IconButton>
              </Tooltip>
            </Box>
          </Alert>
        )}

        {apiKeys.length === 0 ? (
          <EmptyState onCreateClick={onCreateClick} />
        ) : (
          <ApiKeyList
            apiKeys={apiKeys}
            onDeleteClick={onDeleteClick}
          />
        )}
      </CardContent>
    </Card>
  );
}

interface EmptyStateProps {
  onCreateClick: () => void;
}

function EmptyState({ onCreateClick }: EmptyStateProps) {
  return (
    <Box sx={{ textAlign: 'center', py: 6 }}>
      <Box
        sx={{
          width: 80,
          height: 80,
          borderRadius: '50%',
          background:
            'linear-gradient(135deg, rgba(25, 118, 210, 0.1) 0%, rgba(25, 118, 210, 0.05) 100%)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          mb: 3,
        }}
      >
        <VpnKey sx={{ fontSize: 40, color: 'rgba(25, 118, 210, 1)' }} />
      </Box>
      <Typography
        variant="h6"
        sx={{ fontWeight: 600, color: 'text.primary', mb: 1 }}
      >
        No API Keys Yet
      </Typography>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ mb: 3, maxWidth: 400, mx: 'auto' }}
      >
        Create your first API key to start using the Perfana API programmatically.
      </Typography>
      <Button
        variant="outlined"
        startIcon={<Add />}
        onClick={onCreateClick}
        sx={{
          borderColor: 'rgba(25, 118, 210, 0.5)',
          color: 'rgba(25, 118, 210, 1)',
          textTransform: 'none',
          fontWeight: 600,
          px: 3,
          py: 1,
          '&:hover': {
            borderColor: 'rgba(25, 118, 210, 1)',
            background: 'rgba(25, 118, 210, 0.04)',
          },
        }}
      >
        Create your first API key
      </Button>
    </Box>
  );
}

interface ApiKeyListProps {
  apiKeys: ApiKey[];
  onDeleteClick: (apiKey: ApiKey) => void;
}

function ApiKeyList({ apiKeys, onDeleteClick }: ApiKeyListProps) {
  return (
    <List>
      {apiKeys.map((apiKey) => {
        const daysUntilExpiry = getDaysUntilExpiry(apiKey.valid_until);
        const expired = isExpired(apiKey.valid_until);

        return (
          <ListItem key={apiKey.id} divider>
            <ListItemText
              primaryTypographyProps={{ component: 'div' }}
              secondaryTypographyProps={{ component: 'div' }}
              primary={
                <Box display="flex" alignItems="center" gap={2}>
                  <Typography variant="subtitle1" fontWeight={500}>
                    {apiKey.description}
                  </Typography>
                  {getStatusChip(apiKey)}
                  {!expired && daysUntilExpiry > 0 && (
                    <Chip
                      icon={
                        <AccessTime
                          sx={{
                            color:
                              daysUntilExpiry <= 7 ? 'white !important' : undefined,
                          }}
                        />
                      }
                      label={`${daysUntilExpiry} days left`}
                      size="small"
                      sx={
                        daysUntilExpiry <= 7
                          ? {
                              background:
                                'linear-gradient(135deg, #ff9800 0%, #ffb74d 100%)',
                              color: 'white',
                              fontWeight: 600,
                              boxShadow: '0 2px 8px rgba(255, 152, 0, 0.3)',
                              border: 'none',
                            }
                          : {
                              variant: 'outlined',
                              borderColor: 'rgba(0, 0, 0, 0.23)',
                            }
                      }
                    />
                  )}
                </Box>
              }
              secondary={
                <Box sx={{ mt: 1.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Created:{' '}
                    <Box
                      component="span"
                      sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
                    >
                      {formatDate(apiKey.created_at)}
                    </Box>
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Expires:{' '}
                    <Box
                      component="span"
                      sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
                    >
                      {formatDate(apiKey.valid_until)}
                    </Box>
                  </Typography>
                  {apiKey.last_used && (
                    <Typography variant="caption" color="text.secondary" display="block">
                      Last used:{' '}
                      <Box
                        component="span"
                        sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
                      >
                        {formatDate(apiKey.last_used)}
                      </Box>
                    </Typography>
                  )}
                </Box>
              }
            />
            <ListItemSecondaryAction>
              <Tooltip title="Delete">
                <IconButton
                  edge="end"
                  onClick={() => onDeleteClick(apiKey)}
                  sx={{
                    color: 'error.main',
                    '&:hover': {
                      background: 'rgba(244, 67, 54, 0.08)',
                      color: 'error.dark',
                    },
                  }}
                >
                  <Delete />
                </IconButton>
              </Tooltip>
            </ListItemSecondaryAction>
          </ListItem>
        );
      })}
    </List>
  );
}
