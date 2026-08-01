import { useState } from 'react';
import { render, screen, fireEvent, waitFor, createEvent } from '@testing-library/react';
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
    render(
      <MarkdownField label="Content" value={'- not a list'} onChange={jest.fn()} markdown={false} />,
    );
    const preview = screen.getByLabelText('Content preview');

    expect(preview).toHaveTextContent('- not a list');
    expect(preview.querySelector('ul')).toBeNull();
    expect(screen.getByLabelText('Bold')).not.toBeVisible();
  });

  it('preserves line breaks in the plain-text preview, matching the renderer', () => {
    // toHaveTextContent normalises whitespace, so assert the literal text and the
    // pre-wrap that actually carries the newline into the rendered output.
    render(
      <MarkdownField
        label="Content"
        value={'line one\nline two'}
        onChange={jest.fn()}
        markdown={false}
      />,
    );
    const paragraph = screen.getByLabelText('Content preview').querySelector('p')!;

    expect(paragraph.textContent).toBe('line one\nline two');
    expect(paragraph.style.whiteSpace).toBe('pre-wrap');
  });

  it('unwraps instead of stacking when an inline button is clicked twice', async () => {
    // Stacking would produce ****p95****, which prints literal asterisks in the PDF.
    const textarea = setupControlled('the p95 rose');
    textarea.focus();
    textarea.setSelectionRange(4, 7);

    fireEvent.click(screen.getByLabelText('Bold'));
    await waitFor(() => expect(textarea.value).toBe('the **p95** rose'));
    // The caret restore lands a frame later; the second click must see the
    // selection the first one left behind, as a real user's would.
    await waitFor(() => expect(textarea.selectionStart).toBe(6));

    fireEvent.click(screen.getByLabelText('Bold'));
    await waitFor(() => expect(textarea.value).toBe('the p95 rose'));
    expect(textarea.value).not.toContain('****');
  });

  it('unwraps when the selection sits inside existing markers', async () => {
    const textarea = setupControlled('the **p95** rose');
    textarea.focus();
    textarea.setSelectionRange(6, 9);

    fireEvent.click(screen.getByLabelText('Bold'));

    await waitFor(() => expect(textarea.value).toBe('the p95 rose'));
  });

  it('unwraps when the selection includes the markers themselves', async () => {
    // Drag-selecting across bold text takes the asterisks with it. This is the
    // `wrapped` branch; the other unwrap tests only reach `surrounded`.
    const textarea = setupControlled('the **p95** rose');
    textarea.focus();
    textarea.setSelectionRange(4, 11);

    fireEvent.click(screen.getByLabelText('Bold'));

    await waitFor(() => expect(textarea.value).toBe('the p95 rose'));
    await waitFor(() => {
      expect(textarea.selectionStart).toBe(4);
      expect(textarea.selectionEnd).toBe(7);
    });
  });

  it('prevents mousedown so the textarea keeps its selection', () => {
    // Load-bearing and otherwise untestable: fireEvent.click never dispatches
    // mousedown, so jsdom preserves the selection artificially and every
    // "wraps the selection" test would still pass with this handler deleted.
    setup('the p95 rose');
    const button = screen.getByLabelText('Bold');

    const event = createEvent.mouseDown(button);
    fireEvent(button, event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('toggles a block marker off when the line already has it', () => {
    const { onChange, textarea } = setup('## Summary');
    select(textarea, 0, 0);

    fireEvent.click(screen.getByLabelText('Heading'));

    expect(onChange).toHaveBeenCalledWith('Summary');
  });

  it('replaces a different block marker rather than toggling', () => {
    const { onChange, textarea } = setup('- Summary');
    select(textarea, 0, 0);

    fireEvent.click(screen.getByLabelText('Heading'));

    expect(onChange).toHaveBeenCalledWith('## Summary');
  });

  it('expands into a modal and back, keeping the value', () => {
    render(<MarkdownField label="Content" value="## Summary" onChange={jest.fn()} />);

    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByLabelText('Expand editor'));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Content' })).toHaveValue('## Summary');
    // Exactly one editor is mounted at a time, so nothing competes for the ref.
    expect(screen.getAllByRole('textbox')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('formats normally while expanded', async () => {
    function Owner() {
      const [value, setValue] = useState('the p95 rose');
      return <MarkdownField label="Content" value={value} onChange={setValue} />;
    }
    render(<Owner />);

    fireEvent.click(screen.getByLabelText('Expand editor'));
    const textarea = screen.getByRole('textbox', { name: 'Content' }) as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(4, 7);

    fireEvent.click(screen.getByLabelText('Bold'));

    await waitFor(() => expect(textarea.value).toBe('the **p95** rose'));
  });

  it('hides the expand button when the caller opts out', () => {
    render(
      <MarkdownField label="Content" value="" onChange={jest.fn()} expandable={false} />,
    );

    expect(screen.queryByLabelText('Expand editor')).toBeNull();
  });

  it('enforces maxLength and shows the helper text', () => {
    render(
      <MarkdownField
        label="Section Comments"
        value="abc"
        onChange={jest.fn()}
        maxLength={2000}
        helperText="3 / 2000 characters"
      />,
    );

    expect(screen.getByRole('textbox', { name: 'Section Comments' })).toHaveAttribute(
      'maxlength',
      '2000',
    );
    expect(screen.getByText('3 / 2000 characters')).toBeInTheDocument();
  });

  it('calls onBlur so a caller keeping a local draft can commit it', () => {
    const onBlur = jest.fn();
    render(<MarkdownField label="Content" value="x" onChange={jest.fn()} onBlur={onBlur} />);

    fireEvent.blur(screen.getByRole('textbox', { name: 'Content' }));

    expect(onBlur).toHaveBeenCalled();
  });

  it('selects the url placeholder after inserting a link', async () => {
    const textarea = setupControlled('see docs');
    textarea.focus();
    textarea.setSelectionRange(4, 8);

    fireEvent.click(screen.getByLabelText('Link'));

    await waitFor(() => expect(textarea.value).toBe('see [docs](https://)'));
    await waitFor(() =>
      expect(textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)).toBe('https://'),
    );
  });

  it('gives the textarea an accessible name and the toolbar a role', () => {
    setup('');

    expect(screen.getByRole('textbox', { name: 'Content' })).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: 'Content formatting' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Content preview' })).toBeInTheDocument();
    // aria-describedby deliberately absent: pointing it at the live preview made
    // screen readers read back the whole document on every refocus.
    expect(screen.getByRole('textbox', { name: 'Content' })).not.toHaveAttribute(
      'aria-describedby',
    );
  });

  it('renders the preview without the print inline styles so the theme can own it', () => {
    setup('## Summary');
    const heading = screen.getByLabelText('Content preview').querySelector('h2')!;

    expect(heading.getAttribute('style')).toBeNull();
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
