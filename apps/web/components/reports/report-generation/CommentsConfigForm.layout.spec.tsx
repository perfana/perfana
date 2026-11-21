// The Comments section's layout option (analysis stories, PR5): a stored config with no layout
// reads as "By card" and keeps its card filter; choosing "Investigations" writes
// `layout: 'stories'` and hides the card filter, which does not apply to stories.
import { render, screen, fireEvent, within } from '@testing-library/react';
import { CommentsConfigForm } from './SectionConfigs';

jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) })),
}));
jest.mock('./preview/HtmlSectionPreview', () => ({ __esModule: true, default: () => null }));
jest.mock('./preview/ApdexSectionPreview', () => ({ __esModule: true, default: () => null }));

describe('CommentsConfigForm layout', () => {
  it('reads an absent layout as By card and shows the card filter', () => {
    render(<CommentsConfigForm config={{ cards: ['slo'] }} onChange={jest.fn()} onTextChange={jest.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Layout' })).toHaveTextContent('By card');
    expect(screen.getByText(/grouped by the card it was written on/)).toBeInTheDocument();
    expect(screen.getByLabelText('Cards')).toBeInTheDocument();
  });

  it('writes layout: stories and keeps the rest of the config', () => {
    const onChange = jest.fn();
    render(<CommentsConfigForm config={{ cards: ['slo'] }} onChange={onChange} onTextChange={jest.fn()} />);
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Layout' }));
    fireEvent.click(within(screen.getByRole('listbox')).getByText('Investigations'));
    expect(onChange).toHaveBeenCalledWith({ cards: ['slo'], layout: 'stories' });
  });

  it('explains the stories layout and hides the card filter', () => {
    render(<CommentsConfigForm config={{ layout: 'stories' }} onChange={jest.fn()} onTextChange={jest.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Layout' })).toHaveTextContent('Investigations');
    expect(screen.getByText(/Comments in no investigation are left out/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Cards')).not.toBeInTheDocument();
  });
});
