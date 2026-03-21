'use client';

import React, { useState } from 'react';
import {
  Box,
  Typography,
  IconButton,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
} from '@mui/material';
import {
  Delete as DeleteIcon,
  Edit as EditIcon,
  NotificationsActive as AlertIcon,
  Visibility as ViewIcon,
} from '@mui/icons-material';
import { PerfanaEvent, EventSource, deleteEvent } from '@/lib/events';

const SOURCE_CONFIG: Record<EventSource, { label: string; color: 'default' | 'warning' | 'error'; variant: 'outlined' | 'filled' }> = {
  manual: { label: 'Manual', color: 'default', variant: 'outlined' },
  grafana: { label: 'Grafana', color: 'warning', variant: 'filled' },
  alertmanager: { label: 'Alertmanager', color: 'error', variant: 'filled' },
};

interface EventsListProps {
  events: PerfanaEvent[];
  onRefetch: () => void;
  showToast: (message: string) => void;
}

export default function EventsList({ events, onRefetch, showToast }: EventsListProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [eventToDelete, setEventToDelete] = useState<PerfanaEvent | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleDeleteClick = (event: PerfanaEvent) => {
    setEventToDelete(event);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!eventToDelete) return;
    setDeleting(true);
    try {
      await deleteEvent(eventToDelete.id);
      showToast('Event deleted');
      onRefetch();
    } catch (err) {
      const msg = err && typeof err === 'object' && 'message' in err
        ? (err as Error).message
        : 'Failed to delete event';
      showToast(msg);
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
      setEventToDelete(null);
    }
  };

  const getAlertLink = (event: PerfanaEvent): string | null => {
    // Only Grafana alerts have viewable panel/rule URLs.
    // Alertmanager/Prometheus alerts don't carry dashboard URLs.
    if (event.source !== 'grafana' || !event.alertMetadata) return null;
    return (event.alertMetadata.panelUrl as string)
      || (event.alertMetadata.ruleUrl as string)
      || null;
  };

  if (events.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 4 }}>
        <Typography color="text.secondary">No events found for this test run.</Typography>
      </Box>
    );
  }

  return (
    <>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600, width: 110 }}>Source</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Title</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Description</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Timestamp</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Tags</TableCell>
              <TableCell sx={{ fontWeight: 600, width: 80 }} align="center">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {events.map((event) => {
              const source = (event.source || 'manual') as EventSource;
              const config = SOURCE_CONFIG[source] || SOURCE_CONFIG.manual;
              const alertLink = getAlertLink(event);

              return (
                <TableRow key={event.id} hover>
                  <TableCell>
                    <Chip
                      icon={source === 'manual' ? <EditIcon sx={{ fontSize: 14 }} /> : <AlertIcon sx={{ fontSize: 14 }} />}
                      label={config.label}
                      size="small"
                      color={config.color}
                      variant={config.variant}
                      sx={{ fontSize: '0.7rem', height: 24 }}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {event.title}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {event.description || '-'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                      {new Date(event.timestamp).toLocaleString()}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                      {event.tags?.map((tag) => (
                        <Chip key={tag} label={tag} size="small" variant="outlined" sx={{ fontSize: '0.7rem', height: 22 }} />
                      ))}
                    </Box>
                  </TableCell>
                  <TableCell align="center">
                    <Box sx={{ display: 'flex', gap: 0.25, justifyContent: 'center' }}>
                      {alertLink && (
                        <Tooltip title="View in Grafana">
                          <IconButton
                            size="small"
                            component="a"
                            href={alertLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            sx={{ color: 'info.main' }}
                          >
                            <ViewIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      <IconButton
                        size="small"
                        onClick={() => handleDeleteClick(event)}
                        sx={{ color: 'error.main', '&:hover': { backgroundColor: 'error.light', color: 'error.contrastText' } }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>Delete Event</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete the event &quot;{eventToDelete?.title}&quot;? This will also remove any associated Grafana annotations.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>Cancel</Button>
          <Button onClick={handleDeleteConfirm} color="error" variant="contained" disabled={deleting}>
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
