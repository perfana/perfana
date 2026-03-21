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
  CircularProgress,
  Grid,
  Tooltip,
} from '@mui/material';
import { Info as InfoIcon } from '@mui/icons-material';
import { TransactionStat, SamplerStat } from '../types/performance-analysis.types';
import {
  PerformanceMetricsSection,
  TransactionCountsSection,
  ApdexInfoSection,
  NetworkMetricsSection,
  ErrorRateSection,
} from './transaction-details-modal';

interface TransactionDetailsModalProps {
  open: boolean;
  onClose: () => void;
  transaction: TransactionStat | null;
  samplers: SamplerStat[];
  loading: boolean;
}

export default function TransactionDetailsModal({
  open,
  onClose,
  transaction,
  samplers,
  loading,
}: TransactionDetailsModalProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      aria-labelledby="transaction-details-title"
      aria-describedby="transaction-details-description"
    >
      <DialogTitle id="transaction-details-title">
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <InfoIcon sx={{ color: 'primary.main' }} />
          <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>
            Transaction Details
          </Typography>
        </Box>
        <Tooltip title={transaction?.transaction_name || ''} placement="bottom">
          <Typography
            variant="body2"
            sx={{
              color: 'text.secondary',
              mt: 0.5,
              fontFamily: 'monospace',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {transaction?.transaction_name}
          </Typography>
        </Tooltip>
      </DialogTitle>

      <DialogContent sx={{ pt: 3 }}>
        {loading && (
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              flexDirection: 'column',
              py: 6,
              gap: 2,
            }}
          >
            <CircularProgress size={40} />
            <Typography variant="body1" color="text.secondary" sx={{ fontWeight: 600 }}>
              Loading transaction details...
            </Typography>
          </Box>
        )}

        {transaction && !loading && (
          <Box>
            <Grid container spacing={3}>
              <Grid size={12}>
                <PerformanceMetricsSection transaction={transaction} samplers={samplers} />
              </Grid>

              <Grid size={12}>
                <TransactionCountsSection transaction={transaction} />
              </Grid>

              <Grid size={12}>
                <ApdexInfoSection transaction={transaction} />
              </Grid>

              {samplers.length > 0 && (
                <Grid size={12}>
                  <NetworkMetricsSection samplers={samplers} />
                </Grid>
              )}

              <Grid size={12}>
                <ErrorRateSection transaction={transaction} />
              </Grid>
            </Grid>
          </Box>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} variant="contained" autoFocus>
          Close (Esc)
        </Button>
      </DialogActions>
    </Dialog>
  );
}
