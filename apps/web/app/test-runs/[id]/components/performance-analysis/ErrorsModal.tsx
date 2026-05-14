'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  CircularProgress,
  Alert,
  Typography,
  Box,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  Close as CloseIcon,
  ExpandMore as ExpandMoreIcon,
  Error as ErrorIcon,
  ContentCopy as ContentCopyIcon,
} from '@mui/icons-material';
import { authenticatedFetch } from '@/lib/api';

interface ErrorGroup {
  error_type: string;
  response_code: string;
  response_message: string;
  sampler_name: string;
  url: string;
  url_hash: string | null;
  url_pattern: string | null;
  count: number;
  first_occurrence: string;
  last_occurrence: string;
  sample_response_data: string;
  total_requests: number;
  apdex_score: number;
}

/**
 * Masks dynamic data in URLs to show URL patterns
 * - UUIDs → {uuid}
 * - Numeric IDs → {id}
 * - Hash-like strings → {hash}
 */
function maskUrlDynamicData(url: string): string {
  if (!url || url === 'N/A') return url;

  return url
    // Mask UUIDs (8-4-4-4-12 format)
    .replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, '{uuid}')
    // Mask long hex strings (likely hashes) - 16+ hex characters
    .replace(/\/[0-9a-fA-F]{16,}/g, '/{hash}')
    // Mask numeric IDs in paths (e.g., /user/123 → /user/{id})
    .replace(/\/\d+(?=\/|$)/g, '/{id}')
    // Mask query parameter values with numbers
    .replace(/([?&][^=]+)=\d+/g, '$1={id}')
    // Mask query parameter values with UUIDs
    .replace(/([?&][^=]+)=[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, '$1={uuid}');
}

/**
 * Get Apdex label based on score
 */
function getApdexLabel(score: number): string {
  if (score >= 0.94) return 'Excellent';
  if (score >= 0.85) return 'Good';
  if (score >= 0.70) return 'Fair';
  if (score >= 0.50) return 'Poor';
  return 'Unacceptable';
}

/**
 * Get Apdex color based on score
 */
function getApdexColor(score: number): string {
  if (score >= 0.94) return '#4caf50'; // Green
  if (score >= 0.85) return '#66bb6a'; // Light Green
  if (score >= 0.70) return '#ff9800'; // Orange
  if (score >= 0.50) return '#ef5350'; // Red
  return '#f44336'; // Dark Red
}

interface ErrorsModalProps {
  open: boolean;
  onClose: () => void;
  testRunId: string;
  transactionName?: string;
  samplerName?: string;
  title?: string;
  excludeRampUp?: boolean;
}

export default function ErrorsModal({
  open,
  onClose,
  testRunId,
  transactionName,
  samplerName,
  title,
  excludeRampUp = true,
}: ErrorsModalProps) {
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<ErrorGroup[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && testRunId) {
      fetchErrors();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, testRunId, transactionName, samplerName, excludeRampUp]);

  const fetchErrors = async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (transactionName) params.append('transactionName', transactionName);
      if (samplerName) params.append('samplerName', samplerName);
      params.append('excludeRampUp', String(excludeRampUp));

      const queryString = params.toString();
      const url = `/test-runs/${testRunId}/errors${queryString ? `?${queryString}` : ''}`;

      const response = await authenticatedFetch(url);

      if (!response.ok) {
        throw new Error('Failed to fetch errors');
      }

      const data = await response.json();
      setErrors(data);
    } catch (err) {
      const errorMessage =
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to load error data';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  const getErrorTypeColor = (errorType: string): 'error' | 'warning' | 'default' => {
    if (errorType.includes('500') || errorType.includes('Error')) return 'error';
    if (errorType.includes('4')) return 'warning';
    return 'default';
  };

  const getDialogTitle = () => {
    if (title) return title;
    if (samplerName) return `Errors for ${samplerName}`;
    if (transactionName) return `Errors for ${transactionName}`;
    return 'Request Errors';
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xl"
      fullWidth
      PaperProps={{
        sx: {
          minHeight: '600px',
          maxHeight: '90vh',
        },
      }}
    >
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ErrorIcon color="error" />
          <Typography variant="h6">{getDialogTitle()}</Typography>
        </Box>
        <IconButton onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
            <CircularProgress />
          </Box>
        ) : error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : errors.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 8 }}>
            <Typography variant="body1" color="text.secondary">
              No errors found for this test run
            </Typography>
          </Box>
        ) : (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Showing {errors.length} error groups ({errors.reduce((sum, e) => sum + e.count, 0)} total errors)
            </Typography>

            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Error Type</TableCell>
                    <TableCell>Code</TableCell>
                    <TableCell>Message</TableCell>
                    <TableCell>Sampler</TableCell>
                    <TableCell>URL Pattern</TableCell>
                    <TableCell align="right">Errors / Total</TableCell>
                    <TableCell>Apdex</TableCell>
                    <TableCell>First / Last</TableCell>
                    <TableCell>Details</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {errors.map((errorGroup, index) => (
                    <TableRow key={index} hover>
                      <TableCell>
                        <Chip
                          label={errorGroup.error_type}
                          size="small"
                          color={getErrorTypeColor(errorGroup.error_type)}
                          icon={<ErrorIcon />}
                        />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" fontFamily="monospace">
                          {errorGroup.response_code}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Tooltip title={errorGroup.response_message} arrow>
                          <Typography
                            variant="body2"
                            sx={{
                              maxWidth: '200px',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {errorGroup.response_message}
                          </Typography>
                        </Tooltip>
                      </TableCell>
                      <TableCell>
                        <Box>
                          <Typography variant="body2" fontFamily="monospace" fontSize="0.75rem">
                            {errorGroup.sampler_name}
                          </Typography>
                          {errorGroup.url_pattern && (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{
                                fontFamily: 'monospace',
                                fontSize: '0.65rem',
                                display: 'block',
                                mt: 0.5,
                                textTransform: 'none',
                              }}
                            >
                              {errorGroup.url_pattern}
                            </Typography>
                          )}
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Tooltip title={`Full URL: ${errorGroup.url}`} arrow>
                          <Typography
                            variant="body2"
                            sx={{
                              maxWidth: '200px',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              fontFamily: 'monospace',
                              fontSize: '0.75rem',
                              textTransform: 'none',
                            }}
                          >
                            {maskUrlDynamicData(errorGroup.url)}
                          </Typography>
                        </Tooltip>
                      </TableCell>
                      <TableCell align="right">
                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5 }}>
                          <Chip
                            label={`${errorGroup.count} / ${errorGroup.total_requests}`}
                            size="small"
                            color="error"
                            variant="outlined"
                            sx={{ fontFamily: 'monospace' }}
                          />
                          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                            {((errorGroup.count / errorGroup.total_requests) * 100).toFixed(1)}% errors
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={`${errorGroup.apdex_score.toFixed(3)} - ${getApdexLabel(errorGroup.apdex_score)}`}
                          size="small"
                          sx={{
                            backgroundColor: `${getApdexColor(errorGroup.apdex_score)}15`,
                            color: getApdexColor(errorGroup.apdex_score),
                            borderColor: getApdexColor(errorGroup.apdex_score),
                            fontFamily: 'monospace',
                            fontWeight: 600,
                          }}
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption" display="block" color="text.secondary">
                          {formatTimestamp(errorGroup.first_occurrence)}
                        </Typography>
                        <Typography variant="caption" display="block" color="text.secondary">
                          {formatTimestamp(errorGroup.last_occurrence)}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {errorGroup.sample_response_data && (
                          <Accordion elevation={0}>
                            <AccordionSummary
                              expandIcon={<ExpandMoreIcon />}
                              sx={{ minHeight: 'auto', '& .MuiAccordionSummary-content': { margin: '4px 0' } }}
                            >
                              <Typography variant="caption">View Response</Typography>
                            </AccordionSummary>
                            <AccordionDetails>
                              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                {/* URL Information Section */}
                                <Box>
                                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                    <Typography variant="caption" color="text.secondary" fontWeight={600}>
                                      URL Information
                                    </Typography>
                                  </Box>
                                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                    {errorGroup.url_pattern && (
                                      <Box>
                                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                                          Pattern:
                                        </Typography>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                          <Paper
                                            variant="outlined"
                                            sx={{
                                              px: 1,
                                              py: 0.5,
                                              backgroundColor: '#e3f2fd',
                                              flex: 1,
                                            }}
                                          >
                                            <Typography
                                              variant="body2"
                                              sx={{
                                                fontFamily: 'monospace',
                                                fontSize: '0.75rem',
                                                wordBreak: 'break-all',
                                                textTransform: 'none',
                                              }}
                                            >
                                              {errorGroup.url_pattern}
                                            </Typography>
                                          </Paper>
                                          <IconButton
                                            size="small"
                                            onClick={() => handleCopyToClipboard(errorGroup.url_pattern || '')}
                                          >
                                            <ContentCopyIcon fontSize="small" />
                                          </IconButton>
                                        </Box>
                                      </Box>
                                    )}
                                    <Box>
                                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                                        Full URL:
                                      </Typography>
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Paper
                                          variant="outlined"
                                          sx={{
                                            px: 1,
                                            py: 0.5,
                                            backgroundColor: '#f5f5f5',
                                            flex: 1,
                                          }}
                                        >
                                          <Typography
                                            variant="body2"
                                            sx={{
                                              fontFamily: 'monospace',
                                              fontSize: '0.7rem',
                                              wordBreak: 'break-all',
                                              textTransform: 'none',
                                            }}
                                          >
                                            {errorGroup.url}
                                          </Typography>
                                        </Paper>
                                        <IconButton
                                          size="small"
                                          onClick={() => handleCopyToClipboard(errorGroup.url)}
                                        >
                                          <ContentCopyIcon fontSize="small" />
                                        </IconButton>
                                      </Box>
                                    </Box>
                                  </Box>
                                </Box>

                                {/* Response Data Section */}
                                <Box>
                                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                    <Typography variant="caption" color="text.secondary" fontWeight={600}>
                                      Sample Response Data
                                    </Typography>
                                    <IconButton
                                      size="small"
                                      onClick={() => handleCopyToClipboard(errorGroup.sample_response_data)}
                                    >
                                      <ContentCopyIcon fontSize="small" />
                                    </IconButton>
                                  </Box>
                                  <Paper
                                    variant="outlined"
                                    sx={{
                                      p: 1,
                                      maxHeight: '200px',
                                      overflow: 'auto',
                                      backgroundColor: '#f5f5f5',
                                    }}
                                  >
                                    <Typography
                                      variant="body2"
                                      component="pre"
                                      sx={{
                                        fontFamily: 'monospace',
                                        fontSize: '0.7rem',
                                        margin: 0,
                                        whiteSpace: 'pre-wrap',
                                        wordBreak: 'break-word',
                                      }}
                                    >
                                      {errorGroup.sample_response_data}
                                    </Typography>
                                  </Paper>
                                </Box>
                              </Box>
                            </AccordionDetails>
                          </Accordion>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} variant="contained">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
