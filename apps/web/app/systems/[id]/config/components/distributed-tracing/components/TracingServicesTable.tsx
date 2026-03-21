'use client';

import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  IconButton,
  Typography,
} from '@mui/material';
import { Edit as EditIcon, Delete as DeleteIcon } from '@mui/icons-material';
import {
  TracingService,
  getConfigLevelLabel,
  getUiTypeBadgeColor,
} from '../types';

interface TracingServicesTableProps {
  services: TracingService[];
  saving: boolean;
  onEdit: (service: TracingService) => void;
  onDelete: (service: TracingService) => void;
}

export function TracingServicesTable({
  services,
  saving,
  onEdit,
  onDelete,
}: TracingServicesTableProps) {
  return (
    <TableContainer>
      <Table>
        <TableHead>
          <TableRow>
            <TableCell>Level</TableCell>
            <TableCell>Environment</TableCell>
            <TableCell>Workload</TableCell>
            <TableCell>Tracing Instance</TableCell>
            <TableCell>Service Names</TableCell>
            <TableCell align="right">Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {services.map((service) => (
            <TableRow key={service.id}>
              <TableCell>
                <Chip label={getConfigLevelLabel(service)} size="small" />
              </TableCell>
              <TableCell>{service.testEnvironment || '-'}</TableCell>
              <TableCell>{service.workload || '-'}</TableCell>
              <TableCell>
                {service.tracingInstance ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2">
                      {service.tracingInstance.label}
                    </Typography>
                    <Chip
                      label={service.tracingInstance.tracingUi.toUpperCase()}
                      size="small"
                      color={getUiTypeBadgeColor(service.tracingInstance.tracingUi)}
                    />
                  </Box>
                ) : (
                  <Typography variant="body2" color="error">
                    Instance not found (ID: {service.tracingInstanceId})
                  </Typography>
                )}
              </TableCell>
              <TableCell sx={{ maxWidth: 400 }}>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {service.serviceNames?.map((name, idx) => (
                    <Chip key={idx} label={name} size="small" variant="outlined" />
                  ))}
                </Box>
              </TableCell>
              <TableCell align="right">
                <IconButton
                  size="small"
                  onClick={() => onEdit(service)}
                  disabled={saving}
                >
                  <EditIcon fontSize="small" />
                </IconButton>
                <IconButton
                  size="small"
                  color="error"
                  onClick={() => onDelete(service)}
                  disabled={saving}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
