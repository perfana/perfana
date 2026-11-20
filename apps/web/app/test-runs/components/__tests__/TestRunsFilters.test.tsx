import { fireEvent, render, screen, within } from '@testing-library/react';
import { TestRunsFilters } from '../TestRunsFilters';

it('lists filter values case-insensitively sorted and narrows them as you type', () => {
  // protects: filter options are sorted ignoring case and narrow as the user types; a pick reports its value
  // fails_when: a plain sort puts 'Bravo' before 'beta', the typeahead stops filtering, or the pick is not reported
  // seam: none
  // kind: component
  const onSystemChange = jest.fn();
  render(
    <TestRunsFilters
      systemFilter=""
      environmentFilter=""
      workloadFilter=""
      filterOptions={{ systems: ['beta', 'Alpha', 'charlie', 'Bravo'], environments: [], workloads: [] }}
      hasActiveFilters={false}
      onSystemChange={onSystemChange}
      onEnvironmentChange={jest.fn()}
      onWorkloadChange={jest.fn()}
      onResetFilters={jest.fn()}
    />,
  );
  const input = screen.getByLabelText('System');
  input.focus();
  fireEvent.mouseDown(input);
  const names = () => within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent);
  expect(names()).toEqual(['Alpha', 'beta', 'Bravo', 'charlie']);
  fireEvent.change(input, { target: { value: 'br' } });
  expect(names()).toEqual(['Bravo']);
  fireEvent.click(screen.getByRole('option', { name: 'Bravo' }));
  expect(onSystemChange).toHaveBeenCalledWith('Bravo');
});

it('shows the active filter and clearing it means all', () => {
  // protects: a set filter is shown in its typeahead, and clearing it reports '' (all) rather than null
  // fails_when: onChange passes null through, or the value is not mapped back into the Autocomplete
  // seam: none
  // kind: component
  const onEnvironmentChange = jest.fn();
  render(
    <TestRunsFilters
      systemFilter=""
      environmentFilter="acc"
      workloadFilter=""
      filterOptions={{ systems: [], environments: ['acc', 'prod'], workloads: [] }}
      hasActiveFilters
      onSystemChange={jest.fn()}
      onEnvironmentChange={onEnvironmentChange}
      onWorkloadChange={jest.fn()}
      onResetFilters={jest.fn()}
    />,
  );
  expect(screen.getByLabelText('Environment')).toHaveValue('acc');
  fireEvent.click(screen.getByLabelText('Clear'));
  expect(onEnvironmentChange).toHaveBeenCalledWith('');
});

it('keeps a URL filter whose value is not among the options', () => {
  // protects: a filter set from the URL before its options load still shows and stays selectable
  // fails_when: the value is dropped from the options, so the field renders empty or MUI flags it invalid
  // seam: none
  // kind: component
  render(
    <TestRunsFilters
      systemFilter="Delta"
      environmentFilter=""
      workloadFilter=""
      filterOptions={{ systems: [], environments: [], workloads: [] }}
      hasActiveFilters
      onSystemChange={jest.fn()}
      onEnvironmentChange={jest.fn()}
      onWorkloadChange={jest.fn()}
      onResetFilters={jest.fn()}
    />,
  );
  const input = screen.getByLabelText('System');
  expect(input).toHaveValue('Delta');
  input.focus();
  fireEvent.mouseDown(input);
  expect(screen.getByRole('option', { name: 'Delta' })).toBeInTheDocument();
});
