import { render, screen, fireEvent } from '@testing-library/react';
import { ComparisonsConfigForm } from './SectionConfigs';

// Mock authenticatedFetch so the useEffect doesn't blow up in tests
jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) })),
}));

it('reveals baseline_run fields when mode is baseline_run', () => {
  const onChange = jest.fn();
  render(
    <ComparisonsConfigForm
      config={{ comparisonMode: 'baseline_run', thresholds: { good: 10, warning: 50 } }}
      onChange={onChange}
    />
  );
  expect(screen.getByLabelText(/good/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/warning/i)).toBeInTheDocument();
});

it('hides baseline_run fields in control_group mode', () => {
  render(
    <ComparisonsConfigForm
      config={{ comparisonMode: 'control_group' }}
      onChange={jest.fn()}
    />
  );
  expect(screen.queryByLabelText(/good/i)).not.toBeInTheDocument();
});
