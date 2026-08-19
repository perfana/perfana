import React from 'react';
import {
  Assignment as AssignmentIcon,
  CompareArrows as CompareIcon,
  FormatListNumbered as ListNumberedIcon,
  ShowChart as GraphIcon,
  Speed as SpeedIcon,
  Storage as StorageIcon,
  TextFields as TextIcon,
  TrendingUp as TrendingIcon,
  Warning as WarningIcon,
} from '@mui/icons-material';
import { ReportSectionType } from '@/lib/api/reports';

/**
 * How each section type presents itself: icon, label, one-line description and accent colour.
 *
 * Lifted out of GenerateReportDialog so the palette can render from the same source. There is one
 * description per type and it is the only place a section explains itself to the reader.
 */
export const SECTION_CONFIG: Record<ReportSectionType, { icon: React.ReactNode; label: string; description: string; color: string }> = {
  header: {
    icon: <TextIcon />,
    label: 'Header',
    description: 'Section heading with configurable level (H1-H6)',
    color: '#2196f3',
  },
  text_block: {
    icon: <AssignmentIcon />,
    label: 'Text Block',
    description: 'Free-form text content with markdown support',
    color: '#607d8b',
  },
  slo: {
    icon: <AssignmentIcon sx={{ transform: 'rotate(180deg)' }} />,
    label: 'SLO Summary',
    description: 'Service Level Objective results and compliance',
    color: '#4caf50',
  },
  apdex: {
    icon: <SpeedIcon />,
    label: 'Apdex Scores',
    description: 'Application Performance Index scores by transaction',
    color: '#66bb6a',
  },
  transaction_response_times: {
    icon: <TrendingIcon />,
    label: 'Response Times',
    description: 'Transaction response time metrics and percentiles',
    color: '#2196f3',
  },
  regressions: {
    icon: <WarningIcon />,
    label: 'Anomaly Detection',
    description: 'ADAPT anomalies against the control group of previous runs',
    color: '#f44336',
  },
  awr: {
    icon: <StorageIcon />,
    label: 'AWR Analysis',
    description: 'Automatic Workload Repository (Oracle) report',
    color: '#9c27b0',
  },
  trends: {
    icon: <TrendingIcon />,
    label: 'Trend Charts',
    description: 'Historical performance trends over multiple test runs',
    color: '#ff9800',
  },
  comparisons: {
    icon: <CompareIcon />,
    label: 'Test Comparisons',
    description: 'Side-by-side comparison with baseline test runs',
    color: '#795548',
  },
  graphs: {
    icon: <GraphIcon />,
    label: 'Custom Graphs',
    description: 'Performance metrics visualizations',
    color: '#00bcd4',
  },
  top_10_lists: {
    icon: <ListNumberedIcon />,
    label: 'Top 10 Lists',
    description: 'Ranked top-10 lists (slowest, throughput, impact, error rate) for transactions, requests, or URLs',
    color: '#ff9800',
  },
};
