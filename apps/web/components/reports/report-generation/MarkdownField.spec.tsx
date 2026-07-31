import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MarkdownField } from './MarkdownField';

function setup(value = '') {
  const onChange = jest.fn();
  const view = render(<MarkdownField label="Content" value={value} onChange={onChange} />);
  const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
  return { onChange, textarea, view };
}

// The caret is only restored after the new value round-trips through the parent,
// so caret assertions need a real controlled owner rather than a jest.fn().
function setupControlled(initial = '') {
  function Owner() {
    const [value, setValue] = useState(initial);
    return <MarkdownField label="Content" value={value} onChange={setValue} />;
  }
  render(<Owner />);
  return screen.getByRole('textbox') as HTMLTextAreaElement;
}

// Selecting text in jsdom needs the range set explicitly before the toolbar reads it.
function select(textarea: HTMLTextAreaElement, from: number, to: number) {
  textarea.focus();
  textarea.setSelectionRange(from, to);
}

describe('MarkdownField', () => {
  it('wraps the selection in bold markers', () => {
    const { onChange, textarea } = setup('the p95 rose');
    select(textarea, 4, 7);

    fireEvent.click(screen.getByLabelText('Bold'));

    expect(onChange).toHaveBeenCalledWith('the **p95** rose');
  });

  it('inserts sample text when nothing is selected, so a click always does something', () => {
    const { onChange, textarea } = setup('');
    select(textarea, 0, 0);

    fireEvent.click(screen.getByLabelText('Italic'));

    expect(onChange).toHaveBeenCalledWith('*italic text*');
  });

  it('applies list markers to every selected line and numbers them', () => {
    const { onChange, textarea } = setup('checkout\nsearch');
    select(textarea, 0, 15);

    fireEvent.click(screen.getByLabelText('Numbered list'));

    expect(onChange).toHaveBeenCalledWith('1. checkout\n2. search');
  });

  it('replaces an existing marker instead of stacking a second one', () => {
    const { onChange, textarea } = setup('- checkout');
    select(textarea, 0, 0);

    fireEvent.click(screen.getByLabelText('Heading'));

    expect(onChange).toHaveBeenCalledWith('## checkout');
  });

  it('renders a live preview of the current value', () => {
    setup('## Summary\n\nThe **p95** rose');
    const preview = screen.getByLabelText('Content preview');

    expect(preview.querySelector('h2')).toHaveTextContent('Summary');
    expect(preview.querySelector('strong')).toHaveTextContent('p95');
  });

  it('wraps the selection in a link with a url placeholder', () => {
    const { onChange, textarea } = setup('see docs');
    select(textarea, 4, 8);

    fireEvent.click(screen.getByLabelText('Link'));

    expect(onChange).toHaveBeenCalledWith('see [docs](https://)');
  });

  it('inserts sample link text when nothing is selected', () => {
    const { onChange, textarea } = setup('');
    select(textarea, 0, 0);

    fireEvent.click(screen.getByLabelText('Link'));

    expect(onChange).toHaveBeenCalledWith('[link text](https://)');
  });

  it('applies bullet markers to a multi-line selection', () => {
    const { onChange, textarea } = setup('checkout\nsearch');
    select(textarea, 0, 15);

    fireEvent.click(screen.getByLabelText('Bulleted list'));

    expect(onChange).toHaveBeenCalledWith('- checkout\n- search');
  });

  it('inserts block sample text into an empty field', () => {
    const { onChange, textarea } = setup('');
    select(textarea, 0, 0);

    fireEvent.click(screen.getByLabelText('Heading'));

    expect(onChange).toHaveBeenCalledWith('## Heading');
  });

  it('only touches the line the caret is on, leaving the rest of the document alone', () => {
    const { onChange, textarea } = setup('intro\ntarget\noutro');
    select(textarea, 8, 8);

    fireEvent.click(screen.getByLabelText('Bulleted list'));

    expect(onChange).toHaveBeenCalledWith('intro\n- target\noutro');
  });

  it('re-numbers a multi-line selection that already carries bullet markers', () => {
    const { onChange, textarea } = setup('- a\n- b');
    select(textarea, 0, 7);

    fireEvent.click(screen.getByLabelText('Numbered list'));

    expect(onChange).toHaveBeenCalledWith('1. a\n2. b');
  });

  it('re-selects the wrapped text after the value round-trips, so typing replaces it', async () => {
    const textarea = setupControlled('the p95 rose');
    textarea.focus();
    textarea.setSelectionRange(4, 7);

    fireEvent.click(screen.getByLabelText('Bold'));

    await waitFor(() => expect(textarea.value).toBe('the **p95** rose'));
    await waitFor(() => {
      expect(textarea.selectionStart).toBe(6);
      expect(textarea.selectionEnd).toBe(9);
    });
  });

  it('hides the toolbar and previews raw text when markdown is disabled', () => {
    // Must match the renderer's escapeHtml + pre-wrap branch, or the preview lies.
    render(
      <MarkdownField label="Content" value={'- not a list'} onChange={jest.fn()} markdown={false} />,
    );
    const preview = screen.getByLabelText('Content preview');

    expect(preview).toHaveTextContent('- not a list');
    expect(preview.querySelector('ul')).toBeNull();
    expect(screen.getByLabelText('Bold')).not.toBeVisible();
  });

  it('shows placeholder copy in the preview until something is typed', () => {
    const { textarea, onChange } = setup('');

    expect(screen.getByLabelText('Content preview')).toHaveTextContent(
      'Preview appears here as you type',
    );

    fireEvent.change(textarea, { target: { value: 'hello' } });
    expect(onChange).toHaveBeenCalledWith('hello');
  });
});
