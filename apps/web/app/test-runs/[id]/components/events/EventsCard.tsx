'use client';

import React, { useState } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  IconButton,
  Collapse,
  Divider,
  Button,
} from '@mui/material';
import { ExpandMore, ExpandLess, Add } from '@mui/icons-material';
import { TestRun } from '@/types/test-runs';
import { useEventsData } from './hooks';
import { EventsCollapsedView, EventsList, CreateEventDialog } from './components';

interface EventsCardProps {
  testRun: TestRun;
  testRunId: string;
  expanded: boolean;
  onExpand: () => void;
  showToast: (message: string) => void;
}

export default function EventsCard({
  testRun,
  testRunId,
  expanded,
  onExpand,
  showToast,
}: EventsCardProps) {
  const { events, loading, refetch } = useEventsData(testRunId);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const systemUnderTest = testRun.system_under_test_id || testRun.systems_under_test?.id || '';
  const testEnvironment = testRun.test_environment || '';

  return (
    <>
      <Box sx={{
        ...(expanded ? { flex: '1 1 100% !important', minWidth: 'unset' } : {})
      }}>
        <Card
          tabIndex={-1}
          elevation={0}
          data-testid={expanded ? 'events-card-expanded' : 'events-card-collapsed'}
          sx={{
            cursor: expanded ? 'default' : 'pointer',
            height: expanded ? 'auto' : '293px',
            borderRadius: 3,
            bgcolor: 'background.paper',
            border: 'none',
            borderTop: expanded ? 'none' : '3px solid',
            borderTopColor: expanded ? 'transparent' : 'warning.main',
            boxShadow: (theme) => theme.palette.mode === 'dark'
              ? '0 1px 3px rgba(0, 0, 0, 0.3), 0 4px 12px rgba(0, 0, 0, 0.2)'
              : '0 1px 3px rgba(0, 0, 0, 0.08), 0 4px 12px rgba(0, 0, 0, 0.04)',
            transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
            position: 'relative',
            overflow: expanded ? 'visible' : 'hidden',
            '&:hover': expanded ? {} : {
              transform: 'translateY(-4px)',
              boxShadow: (theme) => theme.palette.mode === 'dark'
                ? '0 4px 12px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.3)'
                : '0 4px 12px rgba(0, 0, 0, 0.1), 0 8px 24px rgba(0, 0, 0, 0.08)',
            },
          }}
          onClick={expanded ? undefined : onExpand}
        >
          <CardContent sx={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            p: expanded ? 2 : 3.5,
            pt: expanded ? 2 : 4,
            gap: expanded ? 3 : 0,
            '&:last-child': { pb: expanded ? 2 : 3.5 },
          }}>
            {/* Header */}
            <Box
              display="flex"
              justifyContent="center"
              alignItems="center"
              mb={expanded ? 0 : 2}
              sx={{
                cursor: expanded ? 'pointer' : 'inherit',
                py: expanded ? 1 : 0,
                px: expanded ? 1.25 : 0,
                mx: expanded ? -1.25 : 0,
                borderRadius: 2,
                transition: 'all 0.2s ease',
                ...(expanded ? {
                  position: 'sticky',
                  top: 0,
                  zIndex: 10,
                  bgcolor: 'background.paper',
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                } : {
                  position: 'relative',
                }),
                '&:hover': expanded ? { backgroundColor: 'action.hover' } : {},
              }}
              onClick={expanded ? onExpand : undefined}
            >
              {expanded ? (
                <Box textAlign="center" flex="1">
                  <Typography variant="h5" component="h2" sx={{ fontWeight: 600, color: 'text.primary', fontSize: '1.25rem', lineHeight: 1.2 }}>
                    Events
                  </Typography>
                  <Typography variant="body2" color="text.secondary">Click to collapse</Typography>
                </Box>
              ) : (
                <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600, color: 'text.secondary', fontSize: '0.875rem', letterSpacing: '0.01em', textTransform: 'uppercase', textAlign: 'center' }}>
                  Events
                </Typography>
              )}
              <Box display="flex" alignItems="center" gap={1} sx={{ position: expanded ? 'relative' : 'absolute', right: expanded ? 'auto' : 0 }}>
                {expanded && (
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<Add />}
                    onClick={(e) => { e.stopPropagation(); setCreateDialogOpen(true); }}
                    sx={{ textTransform: 'none' }}
                  >
                    Add Event
                  </Button>
                )}
                <IconButton
                  onClick={(e) => { e.stopPropagation(); onExpand(); }}
                  size="small"
                  sx={{ width: 32, height: 32, color: 'text.secondary', '&:hover': { backgroundColor: (theme) => `${theme.palette.warning.main}26`, color: 'warning.main' }, transition: 'all 0.2s ease' }}
                >
                  {expanded ? <ExpandLess /> : <ExpandMore />}
                </IconButton>
              </Box>
            </Box>

            {/* Collapsed view */}
            {!expanded && (
              <EventsCollapsedView events={events} loading={loading} />
            )}

            {/* Expanded content */}
            <Collapse in={expanded}>
              <Divider sx={{ my: 2 }} />
              <EventsList events={events} onRefetch={refetch} showToast={showToast} />
            </Collapse>
          </CardContent>
        </Card>
      </Box>

      {/* Create dialog */}
      <CreateEventDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        systemUnderTest={systemUnderTest}
        testEnvironment={testEnvironment}
        onCreated={refetch}
        showToast={showToast}
      />
    </>
  );
}
