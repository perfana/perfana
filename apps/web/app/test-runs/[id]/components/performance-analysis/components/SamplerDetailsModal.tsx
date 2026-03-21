'use client';

import React from 'react';
import {
  Box,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Grid,
  Paper,
  Tooltip,
  IconButton,
} from '@mui/material';
import {
  Info as InfoIcon,
  ShowChart as ShowChartIcon,
  TrendingUp as TrendingUpIcon,
  Assessment as AssessmentIcon,
  NetworkCheck as NetworkCheckIcon,
  ContentCopy as ContentCopyIcon,
} from '@mui/icons-material';
import { SamplerStat } from '../types/performance-analysis.types';
import { formatNumber, getApdexColor, getApdexLabel } from '../utils/performance-formatters';

interface SamplerDetailsModalProps {
  open: boolean;
  onClose: () => void;
  sampler: SamplerStat | null;
}

export default function SamplerDetailsModal({
  open,
  onClose,
  sampler,
}: SamplerDetailsModalProps) {
  const handleCopyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <InfoIcon sx={{ color: 'secondary.main' }} />
          <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>
            Request Details
          </Typography>
        </Box>
      </DialogTitle>
      <DialogContent sx={{ pt: 3 }}>
        {sampler && (
          <Box>
            <Grid container spacing={3}>
              {/* Request Name and URL Combined Section */}
              <Grid size={12}>
                <Paper sx={{ p: 3, backgroundColor: 'rgba(25, 118, 210, 0.04)', borderLeft: '4px solid #1976d2' }}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {/* Request Name */}
                    <Box>
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 600, mb: 0.5, display: 'block' }}>
                        Request Name:
                      </Typography>
                      <Typography
                        variant="body1"
                        sx={{
                          fontFamily: 'monospace',
                          fontSize: '0.95rem',
                          fontWeight: 600,
                          color: 'primary.main',
                          wordBreak: 'break-all',
                        }}
                      >
                        {sampler.sampler_name}
                      </Typography>
                    </Box>

                    {/* URL Pattern */}
                    {sampler.url_pattern && (
                      <Box>
                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', fontWeight: 600, mb: 0.5, display: 'block' }}>
                          URL Pattern:
                        </Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography
                            variant="body2"
                            sx={{
                              fontFamily: 'monospace',
                              fontSize: '0.85rem',
                              color: 'text.primary',
                              wordBreak: 'break-all',
                              flex: 1,
                              textTransform: 'none',
                            }}
                          >
                            {sampler.url_pattern}
                          </Typography>
                          <Tooltip title="Copy URL pattern">
                            <IconButton
                              size="small"
                              onClick={() => handleCopyToClipboard(sampler.url_pattern || '')}
                              sx={{ color: 'primary.main' }}
                            >
                              <ContentCopyIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      </Box>
                    )}
                  </Box>
                </Paper>
              </Grid>

              {/* Performance Metrics Section */}
              <Grid size={12}>
                <Paper sx={{ p: 3 }}>
                  <Typography variant="h6" component="h3" gutterBottom sx={{
                    fontWeight: 700,
                    color: 'primary.main',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    mb: 3
                  }}>
                    <ShowChartIcon />
                    Performance Metrics
                  </Typography>
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 6, sm: 4 }}>
                      <Box sx={{ p: 2, borderRadius: 2, background: 'rgba(255, 255, 255, 0.7)', border: '1px solid rgba(25, 118, 210, 0.15)', textAlign: 'center' }}>
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, textTransform: 'uppercase', display: 'block', mb: 1 }}>
                          Avg Response
                        </Typography>
                        <Typography variant="h5" sx={{ fontFamily: 'monospace', fontWeight: 700, color: 'primary.main', mb: 0.5 }}>
                          {formatNumber(sampler.avg_response_time)}
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                          ms
                        </Typography>
                      </Box>
                    </Grid>
                    <Grid size={{ xs: 6, sm: 4 }}>
                      <Box sx={{ p: 2, borderRadius: 2, background: 'rgba(255, 255, 255, 0.7)', border: '1px solid rgba(255, 152, 0, 0.3)', textAlign: 'center' }}>
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, textTransform: 'uppercase', display: 'block', mb: 1 }}>
                          P95 Response
                        </Typography>
                        <Typography variant="h5" sx={{ fontFamily: 'monospace', fontWeight: 700, color: 'warning.main', mb: 0.5 }}>
                          {formatNumber(sampler.p95_response_time)}
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                          ms
                        </Typography>
                      </Box>
                    </Grid>
                    <Grid size={{ xs: 6, sm: 4 }}>
                      <Box sx={{ p: 2, borderRadius: 2, background: 'rgba(255, 255, 255, 0.7)', border: '1px solid rgba(244, 67, 54, 0.3)', textAlign: 'center' }}>
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, textTransform: 'uppercase', display: 'block', mb: 1 }}>
                          P99 Response
                        </Typography>
                        <Typography variant="h5" sx={{ fontFamily: 'monospace', fontWeight: 700, color: 'error.main', mb: 0.5 }}>
                          {formatNumber(sampler.p99_response_time)}
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                          ms
                        </Typography>
                      </Box>
                    </Grid>
                    <Grid size={6}>
                      <Box sx={{ p: 2, borderRadius: 2, background: 'rgba(255, 255, 255, 0.7)', border: '1px solid rgba(76, 175, 80, 0.3)', textAlign: 'center' }}>
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, textTransform: 'uppercase', display: 'block', mb: 1 }}>
                          Min Response
                        </Typography>
                        <Typography variant="h5" sx={{ fontFamily: 'monospace', fontWeight: 700, color: 'success.main', mb: 0.5 }}>
                          {formatNumber(sampler.min_response_time)}
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                          ms
                        </Typography>
                      </Box>
                    </Grid>
                    <Grid size={6}>
                      <Box sx={{ p: 2, borderRadius: 2, background: 'rgba(255, 255, 255, 0.7)', border: '1px solid rgba(0, 0, 0, 0.15)', textAlign: 'center' }}>
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, textTransform: 'uppercase', display: 'block', mb: 1 }}>
                          Max Response
                        </Typography>
                        <Typography variant="h5" sx={{ fontFamily: 'monospace', fontWeight: 700, mb: 0.5 }}>
                          {formatNumber(sampler.max_response_time)}
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                          ms
                        </Typography>
                      </Box>
                    </Grid>
                  </Grid>
                </Paper>
              </Grid>

              {/* Request Counts Section */}
              <Grid size={{ xs: 12, md: 6 }}>
                <Paper sx={{ p: 3 }}>
                  <Typography variant="h6" component="h3" gutterBottom sx={{
                    fontWeight: 700,
                    color: 'success.main',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    mb: 3
                  }}>
                    <TrendingUpIcon />
                    Request Counts
                  </Typography>
                  <Grid container spacing={2}>
                    <Grid size={12}>
                      <Box sx={{ p: 2, borderRadius: 2, background: 'rgba(255, 255, 255, 0.7)', border: '1px solid rgba(76, 175, 80, 0.3)', textAlign: 'center' }}>
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, textTransform: 'uppercase', display: 'block', mb: 1 }}>
                          Passed
                        </Typography>
                        <Typography variant="h5" sx={{ fontFamily: 'monospace', fontWeight: 700, color: 'success.main' }}>
                          {sampler.passed_count.toLocaleString()}
                        </Typography>
                      </Box>
                    </Grid>
                    <Grid size={12}>
                      <Box sx={{ p: 2, borderRadius: 2, background: 'rgba(255, 255, 255, 0.7)', border: '1px solid rgba(244, 67, 54, 0.3)', textAlign: 'center' }}>
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, textTransform: 'uppercase', display: 'block', mb: 1 }}>
                          Failed
                        </Typography>
                        <Typography variant="h5" sx={{ fontFamily: 'monospace', fontWeight: 700, color: 'error.main' }}>
                          {sampler.failed_count.toLocaleString()}
                        </Typography>
                      </Box>
                    </Grid>
                    <Grid size={12}>
                      <Box sx={{ p: 2, borderRadius: 2, background: 'rgba(255, 255, 255, 0.7)', border: '1px solid rgba(0, 0, 0, 0.15)', textAlign: 'center' }}>
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, textTransform: 'uppercase', display: 'block', mb: 1 }}>
                          Total
                        </Typography>
                        <Typography variant="h5" sx={{ fontFamily: 'monospace', fontWeight: 700 }}>
                          {sampler.total_count.toLocaleString()}
                        </Typography>
                      </Box>
                    </Grid>
                  </Grid>
                </Paper>
              </Grid>

              {/* Apdex Section */}
              <Grid size={{ xs: 12, md: 6 }}>
                <Paper sx={{ p: 3 }}>
                  <Typography variant="h6" component="h3" gutterBottom sx={{
                    fontWeight: 700,
                    color: 'secondary.main',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    mb: 3
                  }}>
                    <AssessmentIcon />
                    Apdex
                  </Typography>
                  <Grid container spacing={2}>
                    <Grid size={12}>
                      <Box sx={{
                        p: 2,
                        borderRadius: 2,
                        background: 'rgba(255, 255, 255, 0.7)',
                        border: `2px solid ${getApdexColor(sampler.apdex_score)}`,
                        textAlign: 'center'
                      }}>
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, textTransform: 'uppercase', display: 'block', mb: 1 }}>
                          Apdex Score
                        </Typography>
                        <Typography variant="h5" sx={{ fontFamily: 'monospace', fontWeight: 700, color: getApdexColor(sampler.apdex_score) }}>
                          {sampler.apdex_score.toFixed(3)}
                        </Typography>
                        <Typography variant="caption" sx={{
                          display: 'block',
                          mt: 0.5,
                          fontWeight: 600,
                          color: getApdexColor(sampler.apdex_score)
                        }}>
                          {getApdexLabel(sampler.apdex_score)}
                        </Typography>
                      </Box>
                    </Grid>
                    <Grid size={12}>
                      <Box sx={{ p: 2, borderRadius: 2, background: 'rgba(255, 255, 255, 0.7)', border: '1px solid rgba(0, 0, 0, 0.15)', textAlign: 'center' }}>
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, textTransform: 'uppercase', display: 'block', mb: 1 }}>
                          Threshold (T)
                        </Typography>
                        <Typography variant="h5" sx={{ fontFamily: 'monospace', fontWeight: 700 }}>
                          {sampler.active_threshold}
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                          ms
                        </Typography>
                      </Box>
                    </Grid>
                  </Grid>
                </Paper>
              </Grid>

              {/* Network & Connection Metrics Section */}
              <Grid size={12}>
                <Paper sx={{ p: 3 }}>
                  <Typography variant="h6" component="h3" gutterBottom sx={{
                    fontWeight: 700,
                    color: 'info.main',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    mb: 3
                  }}>
                    <NetworkCheckIcon />
                    Network & Connection Metrics
                  </Typography>
                  <Grid container spacing={2}>
                    <Grid size={6}>
                      <Box sx={{ p: 2, borderRadius: 2, background: 'rgba(255, 255, 255, 0.7)', border: '1px solid rgba(0, 188, 212, 0.3)', textAlign: 'center' }}>
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, textTransform: 'uppercase', display: 'block', mb: 1 }}>
                          Request Size
                        </Typography>
                        <Typography variant="h5" sx={{ fontFamily: 'monospace', fontWeight: 700, color: 'info.main', mb: 0.5 }}>
                          {(sampler.total_request_size / 1024 / 1024).toFixed(2)}
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                          MB
                        </Typography>
                      </Box>
                    </Grid>
                    <Grid size={6}>
                      <Box sx={{ p: 2, borderRadius: 2, background: 'rgba(255, 255, 255, 0.7)', border: '1px solid rgba(0, 188, 212, 0.3)', textAlign: 'center' }}>
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, textTransform: 'uppercase', display: 'block', mb: 1 }}>
                          Response Size
                        </Typography>
                        <Typography variant="h5" sx={{ fontFamily: 'monospace', fontWeight: 700, color: 'info.main', mb: 0.5 }}>
                          {(sampler.total_response_size / 1024 / 1024).toFixed(2)}
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                          MB
                        </Typography>
                      </Box>
                    </Grid>
                    <Grid size={6}>
                      <Box sx={{ p: 2, borderRadius: 2, background: 'rgba(255, 255, 255, 0.7)', border: '1px solid rgba(0, 0, 0, 0.15)', textAlign: 'center' }}>
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, textTransform: 'uppercase', display: 'block', mb: 1 }}>
                          Avg Latency
                        </Typography>
                        <Typography variant="h5" sx={{ fontFamily: 'monospace', fontWeight: 700, mb: 0.5 }}>
                          {formatNumber(sampler.avg_latency)}
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                          ms
                        </Typography>
                      </Box>
                    </Grid>
                    <Grid size={6}>
                      <Box sx={{ p: 2, borderRadius: 2, background: 'rgba(255, 255, 255, 0.7)', border: '1px solid rgba(0, 0, 0, 0.15)', textAlign: 'center' }}>
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, textTransform: 'uppercase', display: 'block', mb: 1 }}>
                          Avg Connect Time
                        </Typography>
                        <Typography variant="h5" sx={{ fontFamily: 'monospace', fontWeight: 700, mb: 0.5 }}>
                          {formatNumber(sampler.avg_connect_time)}
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                          ms
                        </Typography>
                      </Box>
                    </Grid>
                  </Grid>
                </Paper>
              </Grid>
            </Grid>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button
          onClick={onClose}
          variant="contained"
          autoFocus
        >
          Close (Esc)
        </Button>
      </DialogActions>
    </Dialog>
  );
}
