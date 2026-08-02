import { render, screen, fireEvent } from '@testing-library/react';
import SectionPreviewModal from './SectionPreviewModal';

describe('SectionPreviewModal', () => {
  const open = (props: Partial<React.ComponentProps<typeof SectionPreviewModal>> = {}) =>
    render(
      <SectionPreviewModal
        open
        onClose={jest.fn()}
        sectionTitle="Apdex Score"
        sectionType="Apdex"
        initialText=""
        onSaveText={jest.fn()}
        {...props}
      >
        <div>preview content</div>
      </SectionPreviewModal>,
    );

  it('offers the formatting toolbar, not a bare textarea', () => {
    open();
    // The whole point of the change: the same editor as the inline form.
    expect(screen.getByRole('button', { name: /bold/i })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Text' })).toBeInTheDocument();
  });

  it('uses "Text" wording throughout', () => {
    open();
    expect(screen.queryByText(/comment/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Text' })).toBeInTheDocument();
  });

  it('saves the edited text', () => {
    const onSaveText = jest.fn();
    open({ onSaveText });

    fireEvent.change(screen.getByRole('textbox', { name: 'Text' }), {
      target: { value: 'p95 improved 12%' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Text' }));

    expect(onSaveText).toHaveBeenCalledWith('p95 improved 12%');
  });

  it('discards edits on cancel', () => {
    const onSaveText = jest.fn();
    open({ initialText: 'original', onSaveText });

    fireEvent.change(screen.getByRole('textbox', { name: 'Text' }), { target: { value: 'edited' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onSaveText).not.toHaveBeenCalled();
  });
});
