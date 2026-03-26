'use client';

import { useState } from 'react';
import { Box, IconButton, Tooltip } from '@mui/material';
import { ContentCopy, Check } from '@mui/icons-material';
import { TestRun } from '@/types/test-runs';
import KPIDisplay from '../../shared/KPIDisplay';
import SoftBadge from '../../shared/SoftBadge';
import { hasEvaluationError } from '../utils/test-run-formatters';

interface TestRunDetailsCollapsedViewProps {
  testRun: TestRun;
}

export function TestRunDetailsCollapsedView({ testRun }: TestRunDetailsCollapsedViewProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(testRun.test_run_id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {/* Primary KPI Display - Test Run ID */}
      <Box sx={{ py: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <KPIDisplay
          value={testRun.test_run_id.split('-').pop() || testRun.test_run_id}
          label=""
          monospace
        />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, mt: 0.5 }}>
          <Box
            component="span"
            sx={{
              fontSize: '0.75rem',
              color: 'text.secondary',
              fontWeight: 500,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Test Run ID
          </Box>
          <Tooltip title={copied ? 'Copied!' : 'Copy full test run ID'}>
            <IconButton
              size="small"
              onClick={handleCopy}
              sx={{ opacity: 0.5, '&:hover': { opacity: 1 }, p: 0.25 }}
            >
              {copied ? <Check sx={{ fontSize: 14 }} /> : <ContentCopy sx={{ fontSize: 14 }} />}
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Secondary Content - Soft Badges */}
      <Box sx={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 1,
        justifyContent: 'center'
      }}>
        {/* Overall Result Badge */}
        {testRun.consolidated_result && (
          (() => {
            const hasError = hasEvaluationError(testRun);
            const label = hasError ? 'Invalid' : (testRun.consolidated_result.passed || testRun.consolidated_result.overall ? 'Pass' : 'Fail');
            const color = hasError ? 'orange' : (testRun.consolidated_result.passed || testRun.consolidated_result.overall) ? 'green' : 'red';

            return (
              <SoftBadge
                label={label}
                color={color as 'orange' | 'green' | 'red'}
              />
            );
          })()
        )}

        {/* Version Badge - only show if application_release exists */}
        {testRun.application_release && (
          <SoftBadge
            label={testRun.application_release}
            color="blue"
          />
        )}

        {/* CI Build Results Badge - only show if ci_build_results_url exists */}
        {testRun.ci_build_results_url && (
          <SoftBadge
            label="CI Build"
            color="green"
            onClick={(e) => {
              e.stopPropagation();
              window.open(testRun.ci_build_results_url, '_blank');
            }}
          />
        )}

        {/* Status Badge */}
        {!testRun.completed && (
          <SoftBadge
            label="Running"
            color="blue"
          />
        )}

        {/* Data Issues Badge */}
        {testRun.valid === false && (
          <SoftBadge
            label="Data Issues"
            color="orange"
          />
        )}

        {/* Stale Badge */}
        {testRun.is_stale && (
          <SoftBadge
            label="Stale"
            color="orange"
          />
        )}
      </Box>
    </Box>
  );
}
