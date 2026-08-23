import { render, screen, fireEvent } from '@testing-library/react';
import ExpandableCardHeader, {
  kickPlotlyResize,
} from '@/app/test-runs/[id]/components/shared/ExpandableCardHeader';

describe('ExpandableCardHeader', () => {
  it('shows an expand affordance when collapsed and does not make the strip clickable', () => {
    const onToggle = jest.fn();
    render(<ExpandableCardHeader title="Graphs" expanded={false} onToggle={onToggle} />);

    const button = screen.getByLabelText('Expand graphs');
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);

    // The card itself owns the click-to-expand when collapsed; the header must not
    // double-fire it, or expanding immediately collapses again.
    fireEvent.click(screen.getByText('Graphs'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('collapses from the button or from anywhere on the expanded strip', () => {
    const onToggle = jest.fn();
    render(<ExpandableCardHeader title="Compare" expanded onToggle={onToggle} />);

    fireEvent.click(screen.getByLabelText('Collapse compare'));
    expect(onToggle).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('Compare'));
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it('renders the title in both states', () => {
    const { rerender } = render(
      <ExpandableCardHeader title="Trends" expanded={false} onToggle={jest.fn()} />,
    );
    expect(screen.getByText('Trends')).toBeInTheDocument();

    rerender(<ExpandableCardHeader title="Trends" expanded onToggle={jest.fn()} />);
    expect(screen.getByText('Trends')).toBeInTheDocument();
  });
});

describe('kickPlotlyResize', () => {
  it('dispatches the window resize Plotly listens for', () => {
    const onResize = jest.fn();
    window.addEventListener('resize', onResize);

    kickPlotlyResize();

    expect(onResize).toHaveBeenCalledTimes(1);
    window.removeEventListener('resize', onResize);
  });
});
