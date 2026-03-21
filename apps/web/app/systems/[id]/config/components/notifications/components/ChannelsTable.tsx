'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  IconButton,
  Tooltip,
  Typography,
  CircularProgress,
} from '@mui/material';
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  Send as SendIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
} from '@mui/icons-material';
import {
  NotificationChannel,
  getChannelTypeLabel,
  getChannelTypeColor,
} from '../types';

interface ChannelsTableProps {
  channels: NotificationChannel[];
  testing: string | null;
  onTest: (channel: NotificationChannel) => void;
  onEdit: (channel: NotificationChannel) => void;
  onDelete: (channel: NotificationChannel) => void;
}

export function ChannelsTable({
  channels,
  testing,
  onTest,
  onEdit,
  onDelete,
}: ChannelsTableProps) {
  return (
    <TableContainer component={Paper}>
      <Table>
        <TableHead>
          <TableRow>
            <TableCell>Type</TableCell>
            <TableCell>Channel Name</TableCell>
            <TableCell>Notifications</TableCell>
            <TableCell>Status</TableCell>
            <TableCell align="right">Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {channels.map((channel) => (
            <TableRow key={channel.id}>
              <TableCell>
                <Chip
                  label={getChannelTypeLabel(channel.type)}
                  size="small"
                  sx={{
                    backgroundColor: getChannelTypeColor(channel.type),
                    color: 'white',
                  }}
                />
              </TableCell>
              <TableCell>
                <Typography variant="body2" fontWeight="medium">
                  {channel.name}
                </Typography>
              </TableCell>
              <TableCell>
                <Chip
                  label={channel.notifyOnFailedOnly ? 'Failed only' : 'All test runs'}
                  size="small"
                  variant="outlined"
                />
              </TableCell>
              <TableCell>
                {channel.enabled ? (
                  <Chip
                    icon={<CheckCircleIcon />}
                    label="Enabled"
                    size="small"
                    color="success"
                    variant="outlined"
                  />
                ) : (
                  <Chip
                    icon={<ErrorIcon />}
                    label="Disabled"
                    size="small"
                    color="default"
                    variant="outlined"
                  />
                )}
              </TableCell>
              <TableCell align="right">
                <Tooltip title="Send test notification">
                  <IconButton
                    size="small"
                    onClick={() => onTest(channel)}
                    disabled={testing === channel.id || !channel.enabled}
                  >
                    {testing === channel.id ? (
                      <CircularProgress size={20} />
                    ) : (
                      <SendIcon />
                    )}
                  </IconButton>
                </Tooltip>
                <Tooltip title="Edit">
                  <IconButton size="small" onClick={() => onEdit(channel)}>
                    <EditIcon />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Delete">
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => onDelete(channel)}
                  >
                    <DeleteIcon />
                  </IconButton>
                </Tooltip>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
