/**
 * The unit picker's two conditional branches.
 *
 * This popover is the only way a per-series unit override is made or undone, and both of
 * the things that make it usable are conditional: the footer naming the panel's own unit
 * appears only when a `panelUnit` is known, and the reset affordance only when the stored
 * value actually differs from it. Without the reset there is no way back to the panel's
 * unit except guessing which id it was — the footer tells you, the button does it.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import UnitPicker from './UnitPicker';

const open = (over: Partial<React.ComponentProps<typeof UnitPicker>> = {}) => {
  const onSelect = jest.fn();
  const onClose = jest.fn();
  render(
    <UnitPicker
      anchorEl={document.body}
      open
      onClose={onClose}
      mode="light"
      title="Unit · heap used"
      onSelect={onSelect}
      {...over}
    />,
  );
  return { onSelect, onClose };
};

describe('UnitPicker', () => {
  it('names the panel unit in a footer, and only when there is one', () => {
    open({ panelUnit: 'ms', panelSource: 'Grafana' });
    expect(screen.getByText(/Panel unit from Grafana/)).toBeInTheDocument();
  });

  it('shows no footer at all for a series whose panel unit is unknown', () => {
    open({ value: 'ms' });
    expect(screen.queryByText(/Panel unit/)).not.toBeInTheDocument();
  });

  it('offers a reset only once the stored unit differs from the panel unit', () => {
    open({ panelUnit: 'ms', value: 'ms' });
    expect(screen.queryByRole('button', { name: /reset to/ })).not.toBeInTheDocument();
  });

  it('resets to the panel unit and closes, in one click', () => {
    const { onSelect, onClose } = open({ panelUnit: 'ms', value: 'percent' });

    fireEvent.click(screen.getByRole('button', { name: /reset to/ }));

    expect(onSelect).toHaveBeenCalledWith('ms');
    expect(onClose).toHaveBeenCalled();
  });

  it('picks a unit and closes, so one click is the whole interaction', () => {
    const { onSelect, onClose } = open({ value: 'ms' });

    // The chips are the unit LABELS, not the ids — that is what the user reads.
    fireEvent.click(screen.getByText('%'));

    expect(onSelect).toHaveBeenCalledWith('percent');
    expect(onClose).toHaveBeenCalled();
  });
});
