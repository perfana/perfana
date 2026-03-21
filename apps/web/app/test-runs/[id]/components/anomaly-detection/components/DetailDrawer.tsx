import React from 'react';
import {
  Box,
  Drawer,
  IconButton,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  CircularProgress,
  Alert,
  Divider
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import WarningIcon from '@mui/icons-material/Warning';
import { DrawerData } from '../types';
import { generateThresholdData, getConfigSourceInfo } from '../utils';

interface DetailDrawerProps {
  open: boolean;
  onClose: () => void;
  data: DrawerData | null;
  loading: boolean;
  error?: string;
  metricName?: string;
  unit?: string;
}

export default function DetailDrawer({
  open,
  onClose,
  data,
  loading,
  error,
  metricName = 'Metric',
  unit
}: DetailDrawerProps) {
  const getResultIcon = (result: string) => {
    switch (result) {
      case 'passed':
        return <CheckCircleIcon sx={{ color: 'success.main', fontSize: 16 }} />;
      case 'failed':
        return <ErrorIcon sx={{ color: 'error.main', fontSize: 16 }} />;
      case 'skipped':
        return <WarningIcon sx={{ color: 'warning.main', fontSize: 16 }} />;
      default:
        return null;
    }
  };

  const getResultColor = (result: string): 'success' | 'error' | 'warning' | 'default' => {
    switch (result) {
      case 'passed':
        return 'success';
      case 'failed':
        return 'error';
      case 'skipped':
        return 'warning';
      default:
        return 'default';
    }
  };

  const renderContent = () => {
    if (loading) {
      return (
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: '200px'
          }}
        >
          <CircularProgress size={40} />
        </Box>
      );
    }

    if (error) {
      return (
        <Box sx={{ p: 2 }}>
          <Alert severity="error">
            Failed to load detailed statistics: {error}
          </Alert>
        </Box>
      );
    }

    if (!data) {
      return (
        <Box sx={{ p: 2 }}>
          <Alert severity="info">
            No detailed statistics available for this metric.
          </Alert>
        </Box>
      );
    }

    const thresholds = generateThresholdData(data, unit);

    return (
      <Box>
        {/* Statistic Summary */}
        {data.statistic && (
          <Box sx={{ mb: 3 }}>
            <Typography variant="h6" gutterBottom>
              Statistical Summary
            </Typography>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableBody>
                  <TableRow>
                    <TableCell component="th" scope="row" sx={{ fontWeight: 'bold' }}>
                      Test Value
                    </TableCell>
                    <TableCell>{data.statistic.test || '-'}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell component="th" scope="row" sx={{ fontWeight: 'bold' }}>
                      Control Value
                    </TableCell>
                    <TableCell>{data.statistic.control || '-'}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell component="th" scope="row" sx={{ fontWeight: 'bold' }}>
                      Difference
                    </TableCell>
                    <TableCell>{data.statistic.diff || '-'}</TableCell>
                  </TableRow>
                  {data.statistic.effect_size && (
                    <TableRow>
                      <TableCell component="th" scope="row" sx={{ fontWeight: 'bold' }}>
                        Effect Size
                      </TableCell>
                      <TableCell>{data.statistic.effect_size}</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}

        <Divider sx={{ my: 2 }} />

        {/* Threshold Configuration */}
        {thresholds && thresholds.length > 0 && (
          <Box sx={{ mb: 3 }}>
            <Typography variant="h6" gutterBottom>
              Threshold Configuration
            </Typography>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 'bold' }}>Threshold Type</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>Configured Value</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>Valid Range</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>Source</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>Result</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {thresholds.map((threshold, index) => {
                    const configSource = getConfigSourceInfo(threshold.source);
                    return (
                      <TableRow key={index}>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontWeight: 'medium' }}>
                            {threshold.threshold}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">
                            {threshold.configuredValue || 'Not set'}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">
                            {threshold.thresholdValue || 'Not set'}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={configSource.label}
                            color={configSource.color}
                            size="small"
                            variant="outlined"
                            title={configSource.description}
                          />
                        </TableCell>
                        <TableCell>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            {getResultIcon(threshold.result)}
                            <Chip
                              label={threshold.result}
                              color={getResultColor(threshold.result)}
                              size="small"
                              variant="outlined"
                            />
                          </Box>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}

        {/* Additional Data */}
        {data.checks && (
          <Box sx={{ mb: 3 }}>
            <Typography variant="h6" gutterBottom>
              Detailed Checks
            </Typography>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableBody>
                  {Object.entries(data.checks).map(([key, value]) => (
                    <TableRow key={key}>
                      <TableCell component="th" scope="row" sx={{ fontWeight: 'bold', textTransform: 'uppercase' }}>
                        {key}
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          {value && typeof value === 'object' && 'isDifference' in value ? (
                            <>
                              {getResultIcon(value.isDifference === false ? 'passed' : 'failed')}
                              <Chip
                                label={value.isDifference === false ? 'No Significant Difference' : 'Significant Difference'}
                                color={value.isDifference === false ? 'success' : 'error'}
                                size="small"
                                variant="outlined"
                              />
                            </>
                          ) : (
                            <Typography variant="body2">
                              {JSON.stringify(value)}
                            </Typography>
                          )}
                        </Box>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}
      </Box>
    );
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: { xs: '100%', sm: 600, md: 800 },
          maxWidth: '90vw'
        }
      }}
    >
      <Box sx={{ p: 2 }}>
        {/* Header */}
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            mb: 2
          }}
        >
          <Typography variant="h5" component="h2">
            {metricName} - Detailed Statistics
          </Typography>
          <IconButton onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>

        {/* Content */}
        {renderContent()}
      </Box>
    </Drawer>
  );
}