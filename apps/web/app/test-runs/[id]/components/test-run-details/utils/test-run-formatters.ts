import {
  CheckCircle,
  Error as ErrorIcon,
  HourglassEmpty,
  Block,
  RemoveCircle,
} from '@mui/icons-material';
import { SvgIconComponent } from '@mui/icons-material';
import { TestRun } from '@/types/test-runs';

export function formatDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return 'N/A';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${remainingSeconds}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  } else {
    return `${remainingSeconds}s`;
  }
}

export interface EvaluationStatusConfig {
  icon: SvgIconComponent;
  color: string;
  bgColor: string;
  borderColor: string;
  label: string;
}

export function getEvaluationStatusConfig(status?: string, isDark = false): EvaluationStatusConfig {
  switch (status) {
    case 'COMPLETED':
      return {
        icon: CheckCircle,
        color: isDark ? '#a5d6a7' : '#4caf50',
        bgColor: isDark ? 'rgba(102, 187, 106, 0.2)' : 'rgba(76, 175, 80, 0.08)',
        borderColor: isDark ? 'rgba(102, 187, 106, 0.5)' : 'rgba(76, 175, 80, 0.3)',
        label: 'Complete'
      };
    case 'IN_PROGRESS':
      return {
        icon: HourglassEmpty,
        color: isDark ? '#90caf9' : '#2196f3',
        bgColor: isDark ? 'rgba(56, 142, 232, 0.2)' : 'rgba(33, 150, 243, 0.08)',
        borderColor: isDark ? 'rgba(56, 142, 232, 0.5)' : 'rgba(33, 150, 243, 0.3)',
        label: 'In Progress'
      };
    case 'ERROR':
      return {
        icon: ErrorIcon,
        color: isDark ? '#ef9a9a' : '#f44336',
        bgColor: isDark ? 'rgba(239, 83, 80, 0.2)' : 'rgba(244, 67, 54, 0.08)',
        borderColor: isDark ? 'rgba(239, 83, 80, 0.5)' : 'rgba(244, 67, 54, 0.3)',
        label: 'Error'
      };
    case 'FAILED':
      return {
        icon: RemoveCircle,
        color: isDark ? '#ef9a9a' : '#f44336',
        bgColor: isDark ? 'rgba(239, 83, 80, 0.2)' : 'rgba(244, 67, 54, 0.08)',
        borderColor: isDark ? 'rgba(239, 83, 80, 0.5)' : 'rgba(244, 67, 54, 0.3)',
        label: 'Failed'
      };
    case 'NOT_CONFIGURED':
      return {
        icon: Block,
        color: isDark ? '#b0bec5' : '#9e9e9e',
        bgColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(158, 158, 158, 0.08)',
        borderColor: isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(158, 158, 158, 0.3)',
        label: 'Not Configured'
      };
    default:
      return {
        icon: Block,
        color: isDark ? '#b0bec5' : '#9e9e9e',
        bgColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(158, 158, 158, 0.08)',
        borderColor: isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(158, 158, 158, 0.3)',
        label: 'Unknown'
      };
  }
}

export function getAccentColor(testRun: TestRun): string {
  const isInvalid = testRun.valid === false;
  const overallResult = testRun.consolidated_result?.overall;
  const isSuccess = overallResult === true && !isInvalid;
  const isFailed = overallResult === false && !isInvalid;
  const isWarning = (!testRun.completed || (overallResult === null || overallResult === undefined)) && !isInvalid;

  if (isInvalid || isFailed) return '#f44336'; // Red for invalid or failed
  if (isSuccess) return '#4caf50'; // Green for success
  if (isWarning) return '#ff9800'; // Orange for warning
  return '#1976d2'; // Default blue
}

export function hasEvaluationError(testRun: TestRun): boolean {
  return testRun.status?.evaluatingChecks === 'ERROR' ||
    testRun.status?.evaluatingChecks === 'FAILED' ||
    testRun.status?.evaluatingComparisons === 'ERROR' ||
    testRun.status?.evaluatingComparisons === 'FAILED' ||
    testRun.status?.evaluatingAdapt === 'ERROR' ||
    testRun.status?.evaluatingAdapt === 'FAILED';
}
