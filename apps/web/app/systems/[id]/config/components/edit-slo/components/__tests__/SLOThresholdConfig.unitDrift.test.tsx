/**
 * A record keeps its own unit when the live panel's has changed since (adoptPanelUnit), so the
 * field's helper text, placeholder and chip follow thresholdUnit, and a line says the panel
 * now shows something else instead of the stored number being silently relabelled.
 */
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SLOThresholdConfig } from '../SLOThresholdConfig';
import { initialSLOFormData, SLOFormData } from '../../types';

function renderConfig(overrides: Partial<SLOFormData>) {
  render(
    <SLOThresholdConfig
      sloFormData={{ ...initialSLOFormData, requirementValue: '500', selectedPanel: { id: 3, title: 'Latency', yAxesFormat: 's' }, ...overrides }}
      setSloFormData={jest.fn()}
      validationErrors={{}}
      setValidationErrors={jest.fn()}
    />,
  );
}

it('warns when the live panel unit differs from thresholdUnit, and reads thresholdUnit', () => {
  renderConfig({ thresholdUnit: 'ms' });
  expect(screen.getByText(/panel now shows s; the threshold is still read and saved in ms/i)).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: /requirement value/i })).toHaveAttribute('placeholder', 'e.g. 500 ms');
});

it.each<Partial<SLOFormData>>([
  { thresholdUnit: 's' },
  { thresholdUnit: undefined },
  { thresholdUnit: 'ms', evaluateType: 'trend' },
])('says nothing for %j', (overrides) => {
  renderConfig(overrides);
  expect(screen.queryByText(/panel now shows/i)).not.toBeInTheDocument();
});
