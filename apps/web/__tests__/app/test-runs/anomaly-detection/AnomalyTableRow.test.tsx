import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

describe('AnomalyTableRow — overflow fix', () => {
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

  describe('overflow styles on text cells', () => {
    it('dashboard label cell has overflow hidden, ellipsis, and minWidth 0', () => {
      render(<AnomalyTableRow {...defaultProps} />);
      const el = screen.getByText('Span metrics');
      expect(el).toHaveStyle({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 });
    });

    it('panel title cell has overflow hidden, ellipsis, and minWidth 0', () => {
      render(<AnomalyTableRow {...defaultProps} />);
      const el = screen.getByText('95th percentile span durations');
      expect(el).toHaveStyle({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 });
    });

    it('metric name cell has overflow hidden, ellipsis, minWidth 0 (not word-break)', () => {
      render(<AnomalyTableRow {...defaultProps} />);
      const el = screen.getByText('afterburner-be | connection');
      expect(el).toHaveStyle({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 });
      expect(el).not.toHaveStyle({ wordBreak: 'break-word' });
    });
  });

  describe('tooltip on text cells', () => {
    it('dashboard label tooltip shows full text on hover', async () => {
      const user = userEvent.setup();
      render(<AnomalyTableRow {...defaultProps} />);
      await act(async () => {
        await user.hover(screen.getByText('Span metrics'));
      });
      await waitFor(() => {
        const tooltips = screen.getAllByRole('tooltip');
        expect(tooltips.some(t => t.textContent === 'Span metrics')).toBe(true);
      });
    });

    it('panel title tooltip shows full text on hover', async () => {
      const user = userEvent.setup();
      render(<AnomalyTableRow {...defaultProps} />);
      await act(async () => {
        await user.hover(screen.getByText('95th percentile span durations'));
      });
      await waitFor(() => {
        const tooltips = screen.getAllByRole('tooltip');
        expect(tooltips.some(t => t.textContent === '95th percentile span durations')).toBe(true);
      });
    });

    it('metric tooltip shows full metric name on hover', async () => {
      const user = userEvent.setup();
      render(<AnomalyTableRow {...defaultProps} />);
      await act(async () => {
        await user.hover(screen.getByText('afterburner-be | connection'));
      });
      await waitFor(() => {
        const tooltips = screen.getAllByRole('tooltip');
        expect(tooltips.some(t => t.textContent === 'afterburner-be | connection')).toBe(true);
      });
    });

    it('metric tooltip shows "-" when metric_name is null', async () => {
      const user = userEvent.setup();
      const row = { ...baseRow, metric_name: null as unknown as string };
      render(<AnomalyTableRow {...defaultProps} row={row} />);
      const cell = screen.getByText('-');
      await act(async () => {
        await user.hover(cell);
      });
      await waitFor(() => {
        const tooltips = screen.getAllByRole('tooltip');
        expect(tooltips.some(t => t.textContent === '-')).toBe(true);
      });
    });

    it('metric tooltip shows "-" when metric_name is empty string', async () => {
      const user = userEvent.setup();
      const row = { ...baseRow, metric_name: '' };
      render(<AnomalyTableRow {...defaultProps} row={row} />);
      const cell = screen.getByText('-');
      await act(async () => {
        await user.hover(cell);
      });
      await waitFor(() => {
        const tooltips = screen.getAllByRole('tooltip');
        expect(tooltips.some(t => t.textContent === '-')).toBe(true);
      });
    });
  });
});
