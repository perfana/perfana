import { render, screen, fireEvent } from '@testing-library/react';
import {
  HeaderConfigForm,
  TextBlockConfigForm,
  SloConfigForm,
  ApdexConfigForm,
  TransactionResponseTimesConfigForm,
  RegressionsConfigForm,
  GraphsConfigForm,
  AwrConfigForm,
  TrendsConfigForm,
  ComparisonsConfigForm,
  Top10ListsConfigForm,
} from './SectionConfigs';

// Mock authenticatedFetch so data-fetching effects don't blow up in tests
jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) })),
}));

// Capture the props the generic HTML preview receives when the modal opens
const mockHtmlPreviewProps: Array<Record<string, unknown>> = [];
jest.mock('./preview/HtmlSectionPreview', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    mockHtmlPreviewProps.push(props);
    const React = jest.requireActual('react');
    return React.createElement('div', { 'data-testid': 'html-section-preview' });
  },
}));

// Apdex uses a bespoke preview component instead of the generic HTML preview
jest.mock('./preview/ApdexSectionPreview', () => ({
  __esModule: true,
  default: () => {
    const React = jest.requireActual('react');
    return React.createElement('div', { 'data-testid': 'apdex-section-preview' });
  },
}));

// Common shape shared by every section config form
type AnyConfigForm = React.ComponentType<{
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  text?: string;
  onTextChange?: (text: string) => void;
  testRunId?: string;
}>;

// [name, Form, expected previewType, config that enables the preview button]
const FORMS: [string, AnyConfigForm, string, Record<string, unknown>][] = [
  ['HeaderConfigForm', HeaderConfigForm as unknown as AnyConfigForm, 'header', {}],
  ['TextBlockConfigForm', TextBlockConfigForm as unknown as AnyConfigForm, 'text_block', {}],
  ['SloConfigForm', SloConfigForm as unknown as AnyConfigForm, 'slo', {}],
  ['ApdexConfigForm', ApdexConfigForm as unknown as AnyConfigForm, 'apdex', {}],
  [
    'TransactionResponseTimesConfigForm',
    TransactionResponseTimesConfigForm as unknown as AnyConfigForm,
    'transaction_response_times',
    { scenario: 'checkout' },
  ],
  ['RegressionsConfigForm', RegressionsConfigForm as unknown as AnyConfigForm, 'regressions', {}],
  ['GraphsConfigForm', GraphsConfigForm as unknown as AnyConfigForm, 'graphs', {}],
  ['AwrConfigForm', AwrConfigForm as unknown as AnyConfigForm, 'awr', {}],
  ['TrendsConfigForm', TrendsConfigForm as unknown as AnyConfigForm, 'trends', {}],
  ['ComparisonsConfigForm', ComparisonsConfigForm as unknown as AnyConfigForm, 'comparisons', {}],
];

describe.each(FORMS)('%s (shared section config affordances)', (_name, Form, previewType, enableConfig) => {
  beforeEach(() => {
    mockHtmlPreviewProps.length = 0;
  });

  it('renders a Preview Section button, disabled when no test run is selected', () => {
    render(<Form config={{}} onChange={jest.fn()} onTextChange={jest.fn()} />);

    const previewButton = screen.getByRole('button', { name: /preview section/i });
    expect(previewButton).toBeInTheDocument();
    expect(previewButton).toBeDisabled();
  });

  it('opens the preview modal with the correct preview type', async () => {
    render(
      <Form
        config={enableConfig}
        onChange={jest.fn()}
        onTextChange={jest.fn()}
        testRunId="MyApp-acc-loadTest-00001"
      />,
    );

    const previewButton = screen.getByRole('button', { name: /preview section/i });
    expect(previewButton).toBeEnabled();
    fireEvent.click(previewButton);

    if (previewType === 'apdex') {
      // Apdex ships its own bespoke preview component
      expect(await screen.findByTestId('apdex-section-preview')).toBeInTheDocument();
    } else {
      expect(await screen.findByTestId('html-section-preview')).toBeInTheDocument();
      const lastProps = mockHtmlPreviewProps[mockHtmlPreviewProps.length - 1];
      expect(lastProps).toBeDefined();
      expect(lastProps!.sectionType).toBe(previewType);
      expect(lastProps!.testRunId).toBe('MyApp-acc-loadTest-00001');
    }
  });
});

// TextBlockConfigForm deliberately has no accompanying-text editor — its
// Content field already is the text (see the dedicated TextBlockConfigForm
// describe block below) — so it's filtered out of FORMS for this assertion
// rather than special-cased inside the test body.
const FORMS_WITH_TEXT_EDITOR = FORMS.filter(([name]) => name !== 'TextBlockConfigForm');

describe.each(FORMS_WITH_TEXT_EDITOR)(
  '%s (accompanying-text editor wiring)',
  (_name, Form) => {
    it('renders the accompanying-text editor and forwards a blur commit to onTextChange', () => {
      // This is the regression the loop previously missed: every entry here was
      // rendered with `onChange` only, so a form that dropped or misrouted its
      // `onTextChange` prop would still pass every other test in this suite.
      const onTextChange = jest.fn();
      render(
        <Form config={{}} onChange={jest.fn()} onTextChange={onTextChange} testRunId="run-1" />,
      );

      const textField = screen.getByRole('textbox', { name: 'Text' });
      expect(textField).toBeInTheDocument();

      fireEvent.change(textField, { target: { value: 'accompanying text' } });
      expect(onTextChange).not.toHaveBeenCalled();

      fireEvent.blur(textField);
      expect(onTextChange).toHaveBeenCalledWith('accompanying text');
    });
  },
);

it('commits text changes on blur, not on every keystroke', () => {
  const onTextChange = jest.fn();
  render(
    <SloConfigForm
      config={{}}
      onChange={jest.fn()}
      text=""
      onTextChange={onTextChange}
      testRunId="run-1"
    />,
  );

  // Query by role: the text editor's toolbar also carries the field name
  const textField = screen.getByRole('textbox', { name: 'Text' });
  expect(textField).toBeInTheDocument();

  fireEvent.change(textField, { target: { value: 'looks good' } });
  expect(onTextChange).not.toHaveBeenCalled();

  fireEvent.blur(textField);
  expect(onTextChange).toHaveBeenCalledWith('looks good');
});

it('gives a text block no accompanying-text editor — its content is the text', () => {
  render(
    <TextBlockConfigForm config={{ content: 'body' }} onChange={jest.fn()} testRunId="run-1" />,
  );

  expect(screen.queryByRole('textbox', { name: 'Text' })).not.toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Content' })).toBeInTheDocument();
});

it('enables the Preview Section button when a testRunId is provided', () => {
  render(
    <SloConfigForm
      config={{}}
      onChange={jest.fn()}
      onTextChange={jest.fn()}
      testRunId="MyApp-acc-loadTest-00001"
    />,
  );
  expect(screen.getByRole('button', { name: /preview section/i })).toBeEnabled();
});

it('keeps the Preview Section button disabled for response times until a scenario is chosen', () => {
  render(
    <TransactionResponseTimesConfigForm
      config={{}}
      onChange={jest.fn()}
      onTextChange={jest.fn()}
      testRunId="MyApp-acc-loadTest-00001"
    />
  );
  expect(screen.getByRole('button', { name: /preview section/i })).toBeDisabled();
});

describe('TextBlockConfigForm', () => {
  it('stores the markdown editor value straight onto config.content', () => {
    // MarkdownField hands back a string, not a change event — a regression here
    // would silently store "[object Object]" as the report body.
    const onChange = jest.fn();
    render(<TextBlockConfigForm config={{ alignment: 'center' }} onChange={onChange} />);

    const editor = screen.getByPlaceholderText(/write your text here/i);
    fireEvent.change(editor, { target: { value: '## Summary' } });

    expect(onChange).toHaveBeenCalledWith({ alignment: 'center', content: '## Summary' });
  });

  it('writes the Enable Markdown switch onto config and forwards it to the editor', () => {
    // This wiring is what makes the switch functional at all — the renderer
    // ignored config.markdown until now, so a dropped prop would silently
    // restore the dead toggle with every suite still green.
    const onChange = jest.fn();
    const { rerender } = render(<TextBlockConfigForm config={{}} onChange={onChange} />);

    expect(screen.getAllByLabelText('Bold')[0]).toBeVisible();

    const toggle = screen.getByRole('switch', { name: /enable markdown/i });
    expect(toggle).toBeChecked();

    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith({ markdown: false });

    rerender(<TextBlockConfigForm config={{ markdown: false }} onChange={onChange} />);
    // Only one editor now: the text block body — text blocks have no
    // accompanying-text field.
    expect(screen.getAllByLabelText('Bold')[0]).not.toBeVisible();
  });
});

describe('HeaderConfigForm (caption vs accompanying text independence)', () => {
  // This is the exact bug the section-text refactor exists to prevent: before
  // it, the accompanying text was smuggled into `config`, so a naive
  // `const { text, ...rest } = config` split in the dialog would have
  // stripped the header's own caption (also named `config.text`) right along
  // with it. These two fields must stay fully independent.

  it('routes the Header Text field to config.text via onChange, not onTextChange', () => {
    const onChange = jest.fn();
    const onTextChange = jest.fn();
    render(
      <HeaderConfigForm
        config={{ text: 'My Caption', level: 2 }}
        onChange={onChange}
        text="Some accompanying text"
        onTextChange={onTextChange}
        testRunId="run-1"
      />,
    );

    const captionField = screen.getByRole('textbox', { name: 'Header Text' });
    fireEvent.change(captionField, { target: { value: 'New Caption' } });

    // The caption lands in config.text with level preserved — the
    // accompanying-text prop is untouched.
    expect(onChange).toHaveBeenCalledWith({ text: 'New Caption', level: 2 });
    expect(onTextChange).not.toHaveBeenCalled();
  });

  it('routes the accompanying Text field to onTextChange on blur, not into config', () => {
    const onChange = jest.fn();
    const onTextChange = jest.fn();
    render(
      <HeaderConfigForm
        config={{ text: 'My Caption', level: 2 }}
        onChange={onChange}
        text="Some accompanying text"
        onTextChange={onTextChange}
        testRunId="run-1"
      />,
    );

    // Query by role/name: both fields are textboxes, and the accompanying-text
    // editor's toolbar buttons also carry the field name.
    const textField = screen.getByRole('textbox', { name: 'Text' });
    fireEvent.change(textField, { target: { value: 'New accompanying text' } });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.blur(textField);
    expect(onTextChange).toHaveBeenCalledWith('New accompanying text');
    // If the two fields were ever re-merged, this edit would route through
    // onChange (and clobber the caption) instead of onTextChange.
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Top10ListsConfigForm', () => {
  it('renders the scope selector and hides includeUrl unless scope is requests', () => {
    render(<Top10ListsConfigForm config={{}} onChange={() => {}} onTextChange={() => {}} testRunId="tr-1" />);
    expect(screen.getByText(/scope/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/show url/i)).not.toBeInTheDocument();
  });

  it('shows the includeUrl toggle when scope is requests', () => {
    render(
      <Top10ListsConfigForm
        config={{ scope: 'requests' }}
        onChange={() => {}}
        onTextChange={() => {}}
        testRunId="tr-1"
      />,
    );
    expect(screen.getByLabelText(/show url/i)).toBeInTheDocument();
  });
});
