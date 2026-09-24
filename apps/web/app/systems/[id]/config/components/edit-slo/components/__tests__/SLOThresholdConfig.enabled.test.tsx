/**
 * The Enabled checkbox (v0.2.96.15). Before it existed, nothing in the UI could set
 * `benchmarks.enabled`, so a Duplicate clone — which now arrives disabled so it does not
 * collide with its source under `uq_benchmarks_active_metric_target` — would have been
 * unrecoverable. This is that one control.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SLOThresholdConfig } from '../SLOThresholdConfig';
import { initialSLOFormData, SLOFormData } from '../../types';

const formData = (overrides: Partial<SLOFormData> = {}): SLOFormData => ({
  ...initialSLOFormData,
  selectedPanel: { id: 105, title: 'Transaction Error Rate' } as unknown as SLOFormData['selectedPanel'],
  requirementValue: '5',
  ...overrides,
});

function renderConfig(data: SLOFormData) {
  const setSloFormData = jest.fn();
  render(
    <SLOThresholdConfig
      sloFormData={data}
      setSloFormData={setSloFormData}
      validationErrors={{}}
      setValidationErrors={jest.fn()}
    />,
  );
  return { setSloFormData, checkbox: screen.getByRole('checkbox', { name: /enabled/i }) };
}

describe('the Enabled checkbox', () => {
  it('reflects a disabled SLO as unchecked', () => {
    const { checkbox } = renderConfig(formData({ enabled: false }));
    expect(checkbox).not.toBeChecked();
  });

  it('reflects an enabled SLO as checked', () => {
    const { checkbox } = renderConfig(formData({ enabled: true }));
    expect(checkbox).toBeChecked();
  });

  // Driven through real state, so this covers the binding in both directions rather than
  // the shape of the updater the handler happens to build.
  function Harness({ initial }: { initial: boolean }) {
    const [data, setData] = React.useState<SLOFormData>(formData({ enabled: initial }));
    return (
      <>
        <SLOThresholdConfig
          sloFormData={data}
          setSloFormData={setData}
          validationErrors={{}}
          setValidationErrors={jest.fn()}
        />
        <output data-testid="enabled-state">{String(data.enabled)}</output>
      </>
    );
  }

  it('switching a disabled clone on writes enabled=true into the form data', () => {
    render(<Harness initial={false} />);
    const checkbox = screen.getByRole('checkbox', { name: /enabled/i });
    expect(screen.getByTestId('enabled-state')).toHaveTextContent('false');

    fireEvent.click(checkbox);

    expect(screen.getByTestId('enabled-state')).toHaveTextContent('true');
    expect(screen.getByRole('checkbox', { name: /enabled/i })).toBeChecked();
  });

  it('switching an SLO off writes enabled=false', () => {
    render(<Harness initial={true} />);

    fireEvent.click(screen.getByRole('checkbox', { name: /enabled/i }));

    expect(screen.getByTestId('enabled-state')).toHaveTextContent('false');
    expect(screen.getByRole('checkbox', { name: /enabled/i })).not.toBeChecked();
  });

  it('says what a disabled SLO means on a run', () => {
    renderConfig(formData({ enabled: true }));
    expect(screen.getByText(/never evaluated, and produces no result on a test run/i)).toBeInTheDocument();
  });
});
