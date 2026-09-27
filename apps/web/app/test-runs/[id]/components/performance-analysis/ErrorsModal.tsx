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
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  Close as CloseIcon,
  Error as ErrorIcon,
  InfoOutlined as InfoIcon,
} from '@mui/icons-material';
import { authenticatedFetch } from '@/lib/api';
import ErrorDetailsDialog from './error-analysis/components/ErrorDetailsDialog';
import { ErrorDetail } from './error-analysis/types';
import { fetchErrorDetails } from './error-analysis/utils/fetch-error-details';
import {
  getApdexColor,
  getApdexLabel,
  maskUrlDynamicData,
} from './utils/performance-formatters';

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
  total_requests: number;
  apdex_score: number;
}

interface ErrorsModalProps {
  open: boolean;
  onClose: () => void;
  testRunId: string;
  transactionName?: string;
  samplerName?: string;
  title?: string;
  excludeRampUp?: boolean;
  /** Same toast the other Performance Analysis dialogs get; drill-down feedback goes here. */
  showToast?: (message: string) => void;
}

export default function ErrorsModal({
  open,
  onClose,
  testRunId,
  transactionName,
  samplerName,
  title,
  excludeRampUp = true,
  showToast,
}: ErrorsModalProps) {
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<ErrorGroup[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedError, setSelectedError] = useState<ErrorDetail | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [occurrenceNote, setOccurrenceNote] = useState<string | undefined>(undefined);
  const [detailsPendingFor, setDetailsPendingFor] = useState<number | null>(null);

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

  /**
   * Opens the same Error Details dialog the Error Analysis tab uses, so a drill-down from the
   * overview and one from that tab show the error in one shape.
   */
  const handleViewDetails = async (errorGroup: ErrorGroup, rowIndex: number) => {
    if (!transactionName) return;
    setDetailsPendingFor(rowIndex);
    try {
      const details = await fetchErrorDetails(testRunId, {
        transaction: transactionName,
        sampler: errorGroup.sampler_name,
        url: errorGroup.url,
      });
      if (details.length === 0) {
        showToast?.('No stored occurrence found for this error');
        return;
      }
      setSelectedError(details[0] ?? null);
      // The row is an aggregate and the dialog shows ONE occurrence, so say so — but do not
      // claim it is this row's latest. The row is grouped by response code too, while the
      // details lookup keys only on transaction/sampler/url and is not scoped to the analysis
      // window, so the occurrence it returns may belong to a sibling row. See TODOS.md,
      // "The error-details lookup is coarser than the row that opens it".
      setOccurrenceNote(
        errorGroup.count > 1
          ? `One of ${errorGroup.count.toLocaleString()} occurrences on this sampler and URL`
          : undefined,
      );
      setDetailsOpen(true);
    } catch {
      showToast?.('Could not load error details');
    } finally {
      setDetailsPendingFor(null);
    }
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
    <>
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
                    <TableCell align="center">Details</TableCell>
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
                      <TableCell align="center">
                        {/* ponytail: no transaction name means no details endpoint to call; both
                            current call sites pass one, so this only guards a future caller. */}
                        {transactionName && (
                          <Tooltip title="View Error Details" arrow>
                            <IconButton
                              size="small"
                              onClick={() => handleViewDetails(errorGroup, index)}
                              disabled={detailsPendingFor !== null}
                              sx={{ color: 'primary.main' }}
                            >
                              {detailsPendingFor === index ? (
                                <CircularProgress size={18} />
                              ) : (
                                <InfoIcon fontSize="small" />
                              )}
                            </IconButton>
                          </Tooltip>
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

    <ErrorDetailsDialog
      open={detailsOpen}
      onClose={() => {
        setDetailsOpen(false);
        setSelectedError(null);
        setOccurrenceNote(undefined);
      }}
      selectedError={selectedError}
      occurrenceNote={occurrenceNote}
    />
    </>
  );
}
