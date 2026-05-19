import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AnomalyTableRow } from '@/app/test-runs/[id]/components/anomaly-detection/components/table-components/AnomalyTableRow';
import { AnomalyData } from '@/app/test-runs/[id]/components/anomaly-detection/types';

const baseRow: AnomalyData = {
  dashboard_label: 'Span metrics',
  panel_title: '95th percentile span durations',
  metric_name: 'afterburner-be | connection',
  unit: 'ms',
  classification: 'red_duration',
  conclusion_label: 'regression',
  test_value: '120',
  control_group_value: '80',
  difference: '40',
  application_dashboard_id: 'app-1',
  panel_id: '1',
  is_stale: false,
};

const defaultProps = {
  row: baseRow,
  rowKey: 'row-0',
  index: 0,
  isExpanded: false,
  isLast: true,
  testRunId: 'test-run-1',
  drawerData: {},
  onToggleExpanded: jest.fn(),
  onOpenActionMenu: jest.fn(),
  onStaleChipClick: jest.fn(),
  hasActionMenu: false,
};

describe('AnomalyTableRow', () => {
  describe('cell text rendering', () => {
    it('renders dashboard label text', () => {
      render(<AnomalyTableRow {...defaultProps} />);
      expect(screen.getByText('Span metrics')).toBeInTheDocument();
    });

    it('renders panel title text', () => {
      render(<AnomalyTableRow {...defaultProps} />);
      expect(screen.getByText('95th percentile span durations')).toBeInTheDocument();
    });

    it('renders metric name text', () => {
      render(<AnomalyTableRow {...defaultProps} />);
      expect(screen.getByText('afterburner-be | connection')).toBeInTheDocument();
    });

    it('renders "-" for null metric_name', () => {
      const row = { ...baseRow, metric_name: null as unknown as string };
      render(<AnomalyTableRow {...defaultProps} row={row} />);
      expect(screen.getByText('-')).toBeInTheDocument();
    });

    it('renders "-" for undefined metric_name', () => {
      const row = { ...baseRow, metric_name: undefined as unknown as string };
      render(<AnomalyTableRow {...defaultProps} row={row} />);
      expect(screen.getByText('-')).toBeInTheDocument();
    });

    it('renders "-" for empty string metric_name', () => {
      const row = { ...baseRow, metric_name: '' };
      render(<AnomalyTableRow {...defaultProps} row={row} />);
      expect(screen.getByText('-')).toBeInTheDocument();
    });
  });

  describe('text cell wrapping styles', () => {
    it('dashboard label cell allows word wrapping', () => {
      render(<AnomalyTableRow {...defaultProps} />);
      const el = screen.getByText('Span metrics');
      expect(el).toHaveStyle({ overflowWrap: 'break-word', minWidth: 0 });
    });

    it('panel title cell allows word wrapping', () => {
      render(<AnomalyTableRow {...defaultProps} />);
      const el = screen.getByText('95th percentile span durations');
      expect(el).toHaveStyle({ overflowWrap: 'break-word', minWidth: 0 });
    });

    it('metric name cell allows word wrapping', () => {
      render(<AnomalyTableRow {...defaultProps} />);
      const el = screen.getByText('afterburner-be | connection');
      expect(el).toHaveStyle({ overflowWrap: 'break-word', minWidth: 0 });
    });

    it('dashboard label cell does not truncate text', () => {
      render(<AnomalyTableRow {...defaultProps} />);
      const el = screen.getByText('Span metrics');
      expect(el).not.toHaveStyle({ overflow: 'hidden' });
      expect(el).not.toHaveStyle({ whiteSpace: 'nowrap' });
    });
  });
});
