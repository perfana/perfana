import React from 'react';
import {
  CompareArrows as CompareIcon,
  ErrorOutline as ErrorIcon,
  FormatListNumbered as ListNumberedIcon,
  Notes as NotesIcon,
  Rule as RuleIcon,
  ShowChart as GraphIcon,
  Speed as SpeedIcon,
  Storage as StorageIcon,
  TextFields as TextIcon,
  Timeline as TimelineIcon,
  Toc as TocIcon,
  TrendingUp as TrendingIcon,
  Warning as WarningIcon,
} from '@mui/icons-material';
import { ReportSectionType } from '@/lib/api/reports';

/**
 * How each section type presents itself: icon, label, one-line description and accent colour.
 *
 * Lifted out of GenerateReportDialog so the palette can render from the same source. There is one
 * description per type and it is the only place a section explains itself to the reader.
 *
 * The accent and icon are the section's identity: the palette entry, the card avatar and the
 * order badge all key off them, so every one of the thirteen must be distinguishable from every
 * other. They previously were not — `header` and `transaction_response_times` shared #2196f3,
 * `trends` and `top_10_lists` shared #ff9800, `trends` and `transaction_response_times` shared
 * an icon, and `text_block`/`slo` were the same icon rotated. The darker accents (brown #795548,
 * blue-grey #607d8b) also sat near the 3:1 non-text contrast floor on dark-mode paper.
 *
 * These stay literals rather than theme tokens: it is a closed set of eleven, and a theme
 * palette extension for values that never vary by theme would be indirection for its own sake.
 */
export const SECTION_CONFIG: Record<ReportSectionType, { icon: React.ReactNode; label: string; description: string; color: string }> = {
  header: {
    icon: <TextIcon />,
    label: 'Header',
    description: 'Section heading with configurable level (H1-H6)',
    color: '#1e88e5',
  },
  text_block: {
    icon: <NotesIcon />,
    label: 'Text Block',
    description: 'Free-form text content with markdown support',
    color: '#5e35b1',
  },
  slo: {
    icon: <RuleIcon />,
    label: 'SLO Summary',
    description: 'Service Level Objective results and compliance',
    color: '#00897b',
  },
  apdex: {
    icon: <SpeedIcon />,
    label: 'Apdex Scores',
    description: 'Application Performance Index scores by transaction',
    color: '#43a047',
  },
  transaction_response_times: {
    icon: <TimelineIcon />,
    label: 'Response Times',
    description: 'Transaction response time metrics and percentiles',
    color: '#039be5',
  },
  regressions: {
    icon: <WarningIcon />,
    label: 'Anomaly Detection',
    description: 'ADAPT anomalies against the control group of previous runs',
    color: '#e53935',
  },
  awr: {
    icon: <StorageIcon />,
    label: 'AWR Analysis',
    description: 'Automatic Workload Repository (Oracle) report',
    color: '#8e24aa',
  },
  trends: {
    icon: <TrendingIcon />,
    label: 'Trend Charts',
    description: 'Historical performance trends over multiple test runs',
    color: '#fb8c00',
  },
  comparisons: {
    icon: <CompareIcon />,
    label: 'Test Comparisons',
    description: 'Side-by-side comparison with baseline test runs',
    color: '#d81b60',
  },
  graphs: {
    icon: <GraphIcon />,
    label: 'Custom Graphs',
    description: 'Performance metrics visualizations',
    color: '#00acc1',
  },
  error_analysis: {
    icon: <ErrorIcon />,
    label: 'Error Analysis',
    description: 'Failed requests by response code, transaction and time',
    color: '#c62828',
  },
  top_10_lists: {
    icon: <ListNumberedIcon />,
    label: 'Top 10 Lists',
    description: 'Ranked top-10 lists (slowest, throughput, impact, error rate) for transactions, requests, or URLs',
    color: '#7cb342',
  },
  index: {
    icon: <TocIcon />,
    label: 'Section Index',
    description: "Clickable table of contents linking to the report's other sections",
    color: '#3949ab',
  },
};
