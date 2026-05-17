import React from 'react';
import { Box, Typography, Button, IconButton, Tooltip, Divider } from '@mui/material';
import { ArrowBack, NavigateBefore, NavigateNext } from '@mui/icons-material';
import { useRouter } from 'next/navigation';
import { TestRun } from '@/types/test-runs';
import TestRunActionsMenu from './TestRunActionsMenu';
import { AbortTestRunButton } from '../../components/AbortTestRunButton';

interface RelatedTestRun {
  test_run_id: string;
  created_at: string;
}

interface TestRunHeaderProps {
  testRun: TestRun | null;
  onBack: () => void;
  previousTestRun?: RelatedTestRun;
  nextTestRun?: RelatedTestRun;
  onSuccess?: (message: string) => void;
  onError?: (message: string) => void;
  onRefresh?: () => void;
  /** Called when a job is triggered from this view (Re-evaluate, Refresh) */
  onJobTriggered?: () => void;
}

export default function TestRunHeader({
  testRun,
  onBack,
  previousTestRun,
  nextTestRun,
  onSuccess,
  onError,
  onRefresh,
  onJobTriggered,
}: TestRunHeaderProps) {
  const router = useRouter();

  const navigateToTestRun = (testRunId: string) => {
    if (!testRun) return;

    // Use system name for query parameters (backend still supports this for backward compatibility)
    const systemName = testRun.systems_under_test?.name;
    const environment = testRun.test_environment;
    const workload = testRun.workload;

    // Only include query parameters if we have all the required values
    if (systemName && environment && workload) {
      const queryParams = new URLSearchParams({
        system: systemName,
        environment: environment,
        workload: workload
      });
      router.push(`/test-runs/${testRunId}?${queryParams.toString()}`);
    } else {
      // Fallback to UUID-only approach if we don't have complete context
      router.push(`/test-runs/${testRunId}`);
    }
  };

  return (
    <Box sx={{ 
      backgroundColor: 'background.paper',
      borderBottom: '1px solid',
      borderColor: 'divider',
      mb: 3,
      py: 2,
      px: 0
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <Button
            startIcon={<ArrowBack />}
            onClick={onBack}
            sx={{ 
              color: 'text.secondary',
              minWidth: 'auto',
              '&:hover': {
                backgroundColor: 'action.hover',
                color: 'primary.main'
              }
            }}
            variant="text"
            size="small"
          >
            Back
          </Button>
          
          <Typography 
            variant="h4" 
            component="h1" 
            sx={{ 
              fontWeight: 600,
              color: 'text.primary',
              letterSpacing: '-0.02em',
              fontSize: '1.75rem'
            }}
          >
            Test Run Details
          </Typography>
        </Box>

        {/* Right side: navigation and chips */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {/* Previous/Next Test Run Navigation */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Tooltip title={previousTestRun ? `Previous test run: ${previousTestRun.test_run_id}` : 'No previous test run'}>
              <span>
                <IconButton
                  onClick={() => previousTestRun && navigateToTestRun(previousTestRun.test_run_id)}
                  disabled={!previousTestRun}
                  size="small"
                  sx={{
                    color: previousTestRun ? 'text.secondary' : 'text.disabled',
                    '&:hover': previousTestRun ? {
                      backgroundColor: 'action.hover',
                      color: 'primary.main'
                    } : {},
                    '&.Mui-disabled': {
                      color: 'text.disabled'
                    }
                  }}
                >
                  <NavigateBefore />
                </IconButton>
              </span>
            </Tooltip>

            <Tooltip title={nextTestRun ? `Next test run: ${nextTestRun.test_run_id}` : 'No next test run'}>
              <span>
                <IconButton
                  onClick={() => nextTestRun && navigateToTestRun(nextTestRun.test_run_id)}
                  disabled={!nextTestRun}
                  size="small"
                  sx={{
                    color: nextTestRun ? 'text.secondary' : 'text.disabled',
                    '&:hover': nextTestRun ? {
                      backgroundColor: 'action.hover',
                      color: 'primary.main'
                    } : {},
                    '&.Mui-disabled': {
                      color: 'text.disabled'
                    }
                  }}
                >
                  <NavigateNext />
                </IconButton>
              </span>
            </Tooltip>
          </Box>

          {/* Actions Menu */}
          {testRun && (
            <>
              <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />
              <AbortTestRunButton
                testRun={testRun}
                onAborted={onRefresh ?? (() => {})}
                showToast={onSuccess ?? (() => {})}
                variant="button"
              />
              <TestRunActionsMenu
                testRun={testRun}
                onSuccess={onSuccess}
                onError={onError}
                onRefresh={onRefresh}
                onDeleted={() => router.push('/test-runs')}
                onJobTriggered={onJobTriggered}
              />
            </>
          )}
        </Box>
      </Box>
    </Box>
  );
}