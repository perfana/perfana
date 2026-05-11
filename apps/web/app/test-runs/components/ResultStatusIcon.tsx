'use client';

import { Box, Typography, CircularProgress, Tooltip } from '@mui/material';
import { TestRun } from '@/types/test-runs';

interface ResultStatusIconProps {
  testRun: TestRun;
}

export function ResultStatusIcon({ testRun }: ResultStatusIconProps): JSX.Element {
  // Check if any pipeline stage is IN_PROGRESS
  const status = testRun.status as unknown;
  const statusObj = status as {
    activeJob?: { stageName?: string } | null;
    evaluatingChecks?: string;
    evaluatingComparisons?: string;
    evaluatingAdapt?: string;
  } | undefined;

  const activeJob = statusObj?.activeJob;
  const isInProgress =
    !!activeJob ||
    statusObj?.evaluatingChecks === 'IN_PROGRESS' ||
    statusObj?.evaluatingComparisons === 'IN_PROGRESS' ||
    statusObj?.evaluatingAdapt === 'IN_PROGRESS';

  const spinnerTooltip = activeJob?.stageName
    ? `${activeJob.stageName} in progress`
    : 'Test run evaluation in progress';

  // Show progress indicator if any pipeline is in progress
  if (isInProgress) {
    return (
      <Tooltip
        title={spinnerTooltip}
        arrow
        placement="top"
      >
        <CircularProgress
          size={20}
          thickness={4}
          sx={{
            color: '#1976d2',
          }}
        />
      </Tooltip>
    );
  }

  // Show spinner for incomplete test runs (loading state)
  if (!testRun.completed) {
    return (
      <Tooltip
        title="Test run in progress"
        arrow
        placement="top"
      >
        <CircularProgress
          size={20}
          thickness={4}
          sx={{
            color: '#1976d2',
          }}
        />
      </Tooltip>
    );
  }

  // No consolidated result on a completed test run means no SLOs/checks configured
  if (!testRun.consolidated_result) {
    return (
      <Tooltip
        title="No checks configured"
        arrow
        placement="top"
      >
        <Box sx={{
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #9e9e9e 0%, #bdbdbd 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'help',
        }}>
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'white', lineHeight: 1 }}>
            —
          </Typography>
        </Box>
      </Tooltip>
    );
  }

  const overallResult = testRun.consolidated_result?.overall;
  const isInvalid = testRun.valid === false;
  const isSuccess = overallResult === true && !isInvalid;
  const isFailed = overallResult === false && !isInvalid;

  // Create detailed breakdown for tooltip
  const sloResult = testRun.consolidated_result?.meetsRequirement;
  const anomalyResult = testRun.consolidated_result?.adaptTestRunOK;

  const tooltipContent = (
    <Box sx={{ p: 1 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'white', mb: 1 }}>
        {isInvalid ? 'Test Run Status' : 'Detailed Results'}
      </Typography>
      {isInvalid ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          {testRun.reasons_not_valid && testRun.reasons_not_valid.length > 0 ? (
            testRun.reasons_not_valid.map((reason, i) => (
              <Typography key={i} variant="body2" sx={{ color: 'white', fontSize: '0.75rem' }}>
                {reason.length > 120 ? `${reason.substring(0, 120)}...` : reason}
              </Typography>
            ))
          ) : (
            <Typography variant="body2" sx={{ color: 'white', fontSize: '0.75rem' }}>
              Test run validation failed
            </Typography>
          )}
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{
              width: 16,
              height: 16,
              borderRadius: '50%',
              background: sloResult === true
                ? 'linear-gradient(135deg, #4caf50 0%, #66bb6a 100%)'
                : sloResult === false
                ? 'linear-gradient(135deg, #f44336 0%, #ef5350 100%)'
                : 'linear-gradient(135deg, #ff9800 0%, #ffb74d 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontSize: '10px',
              fontWeight: 'bold'
            }}>
              {sloResult === true ? '✓' : sloResult === false ? '✕' : '!'}
            </Box>
            <Typography variant="body2" sx={{ color: 'white', fontSize: '0.75rem' }}>
              Service Level Objectives
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{
              width: 16,
              height: 16,
              borderRadius: '50%',
              background: anomalyResult === true
                ? 'linear-gradient(135deg, #4caf50 0%, #66bb6a 100%)'
                : anomalyResult === false
                ? 'linear-gradient(135deg, #f44336 0%, #ef5350 100%)'
                : 'linear-gradient(135deg, #ff9800 0%, #ffb74d 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontSize: '10px',
              fontWeight: 'bold'
            }}>
              {anomalyResult === true ? '✓' : anomalyResult === false ? '✕' : '!'}
            </Box>
            <Typography variant="body2" sx={{ color: 'white', fontSize: '0.75rem' }}>
              Anomaly Detection
            </Typography>
          </Box>

          {testRun.data_warnings && testRun.data_warnings.length > 0 && (
            <Box sx={{ mt: 0.5, pt: 0.5, borderTop: '1px solid rgba(255, 255, 255, 0.15)' }}>
              <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: '0.7rem', fontStyle: 'italic' }}>
                {testRun.data_warnings.length} data warning(s)
              </Typography>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );

  return (
    <Tooltip
      title={tooltipContent}
      arrow
      placement="top"
      sx={{
        '& .MuiTooltip-tooltip': {
          backgroundColor: 'rgba(33, 33, 33, 0.95)',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '8px',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
          maxWidth: 280,
        },
        '& .MuiTooltip-arrow': {
          color: 'rgba(33, 33, 33, 0.95)',
        }
      }}
    >
      <Box sx={{
        width: 20,
        height: 20,
        borderRadius: '50%',
        background: isInvalid
          ? 'linear-gradient(135deg, #ff9800 0%, #ffb74d 100%)'
          : isSuccess
          ? 'linear-gradient(135deg, #4caf50 0%, #66bb6a 100%)'
          : isFailed
          ? 'linear-gradient(135deg, #f44336 0%, #ef5350 100%)'
          : 'linear-gradient(135deg, #ff9800 0%, #ffb74d 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: isInvalid
          ? '0 2px 8px rgba(255, 152, 0, 0.3)'
          : isSuccess
          ? '0 2px 8px rgba(76, 175, 80, 0.3)'
          : isFailed
          ? '0 2px 8px rgba(244, 67, 54, 0.3)'
          : '0 2px 8px rgba(255, 152, 0, 0.3)',
        cursor: 'help',
        transition: 'all 0.2s ease',
        '&:hover': {
          transform: 'scale(1.05)',
          boxShadow: isInvalid
            ? '0 4px 12px rgba(255, 152, 0, 0.4)'
            : isSuccess
            ? '0 4px 12px rgba(76, 175, 80, 0.4)'
            : isFailed
            ? '0 4px 12px rgba(244, 67, 54, 0.4)'
            : '0 4px 12px rgba(255, 152, 0, 0.4)'
        }
      }}>
        <Typography sx={{
          fontSize: '0.75rem',
          fontWeight: 'bold',
          color: 'white',
          textShadow: '0 1px 2px rgba(0,0,0,0.2)',
          lineHeight: 1
        }}>
          {isInvalid ? '!' : isSuccess ? '✓' : isFailed ? '✕' : '!'}
        </Typography>
      </Box>
    </Tooltip>
  );
}
