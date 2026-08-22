import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GraphPresetsAPI } from '@/lib/graph-presets';
import {
  HeaderConfigForm,
  TextBlockConfigForm,
  SloConfigForm,
  ApdexConfigForm,
  TransactionResponseTimesConfigForm,
  RegressionsConfigForm,
  GraphsConfigForm,
  ErrorAnalysisConfigForm,
  AwrConfigForm,
  TrendsConfigForm,
  ComparisonsConfigForm,
  Top10ListsConfigForm,
} from './SectionConfigs';

// Mock authenticatedFetch so data-fetching effects don't blow up in tests
// The comparisons form needs at least one baseline candidate before its preview button
// unlocks, and every other form ignores the payload.
jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve([{ test_run_id: 'MyApp-acc-loadTest-00000', test_environment: 'acc', workload: 'loadTest' }]),
  })),
}));

// Capture the props the generic HTML preview receives when the modal opens
const mockHtmlPreviewProps: Array<Record<string, unknown>> = [];
jest.mock('@/lib/graph-presets', () => ({
  GraphPresetsAPI: {
    getAll: jest.fn().mockResolvedValue([
      { id: 'preset-1', name: 'JVM overview', seriesConfig: [{}, {}], isGlobal: false },
      { id: 'preset-2', name: 'Docker CPU', seriesConfig: [{}], isGlobal: true },
    ]),
  },
}));

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
  [
    'ComparisonsConfigForm',
    ComparisonsConfigForm as unknown as AnyConfigForm,
    'comparisons',
    // Without a baseline there is nothing to preview, so the button stays disabled
    { baselineTestRunId: 'MyApp-acc-loadTest-00000' },
  ],
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
        systemUnderTestId="sut-1"
      />,
    );

    const previewButton = await screen.findByRole('button', { name: /preview section/i });
    await waitFor(() => expect(previewButton).toBeEnabled());
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

it('allows previewing response times with no scenario chosen, which means all of them', () => {
  // The section takes a scenario list now, and an empty list is a valid
  // selection — every scenario in the run — so there is nothing to wait for.
  render(
    <TransactionResponseTimesConfigForm
      config={{}}
      onChange={jest.fn()}
      onTextChange={jest.fn()}
      testRunId="MyApp-acc-loadTest-00001"
    />
  );
  expect(screen.getByRole('button', { name: /preview section/i })).toBeEnabled();
});

it('migrates a legacy single-scenario config to a list when the selection changes', () => {
  const onChange = jest.fn();
  render(
    <TransactionResponseTimesConfigForm
      config={{ scenario: 'CheckoutFlow' }}
      onChange={onChange}
      onTextChange={jest.fn()}
      testRunId="MyApp-acc-loadTest-00001"
    />
  );

  // With no fetched scenario list the form falls back to the free-text field,
  // pre-filled from the legacy single value.
  const field = screen.getByLabelText(/scenario names/i);
  expect(field).toHaveValue('CheckoutFlow');

  fireEvent.change(field, { target: { value: 'CheckoutFlow, BrowseAndSearch' } });

  expect(onChange).toHaveBeenCalledWith({ scenarios: ['CheckoutFlow', 'BrowseAndSearch'] });
});

it('offers a child requests toggle that writes includeChildRequests', () => {
  const onChange = jest.fn();
  render(
    <TransactionResponseTimesConfigForm
      config={{}}
      onChange={onChange}
      onTextChange={jest.fn()}
      testRunId="MyApp-acc-loadTest-00001"
    />
  );

  fireEvent.click(screen.getByLabelText(/include child requests/i));

  expect(onChange).toHaveBeenCalledWith({ includeChildRequests: true });
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

  it('keeps both fields populated and independent when both are set at once', () => {
    const onChange = jest.fn();
    const onTextChange = jest.fn();
    render(
      <HeaderConfigForm
        config={{ text: 'My Caption', level: 2 }}
        onChange={onChange}
        text="Accompanying prose"
        onTextChange={onTextChange}
        testRunId="run-1"
      />,
    );

    const captionField = screen.getByRole('textbox', { name: 'Header Text' });
    const textField = screen.getByRole('textbox', { name: 'Text' });

    // Both fields show their own value simultaneously — this is the exact
    // collision this branch exists to prevent.
    expect(captionField).toHaveValue('My Caption');
    expect(textField).toHaveValue('Accompanying prose');

    // Editing the caption leaves the accompanying-text callback untouched,
    // and the level carried in the onChange payload is unaffected.
    fireEvent.change(captionField, { target: { value: 'New Caption' } });
    expect(onChange).toHaveBeenCalledWith({ text: 'New Caption', level: 2 });
    expect(onTextChange).not.toHaveBeenCalled();

    // Editing the accompanying text leaves the caption callback untouched.
    fireEvent.change(textField, { target: { value: 'New accompanying text' } });
    fireEvent.blur(textField);
    expect(onTextChange).toHaveBeenCalledWith('New accompanying text');
    expect(onChange).toHaveBeenCalledTimes(1); // still just the earlier caption edit
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

describe('GraphsConfigForm', () => {
  it('offers the run\'s graph presets and stores the chosen ids', async () => {
    const onChange = jest.fn();
    render(
      <GraphsConfigForm
        config={{}}
        onChange={onChange}
        onTextChange={jest.fn()}
        testRunId="MyApp-acc-loadTest-00001"
      />
    );

    // Presets arrive from the same endpoint the Graphs card uses
    expect(GraphPresetsAPI.getAll).toHaveBeenCalledWith('MyApp-acc-loadTest-00001');
    const picker = await screen.findByText('Auto-discover panels');

    fireEvent.mouseDown(picker);
    fireEvent.click(await screen.findByText('JVM overview'));

    expect(onChange).toHaveBeenCalledWith({ graphPresetIds: ['preset-1'] });
  });

  it('shows the selected preset names rather than their ids', async () => {
    render(
      <GraphsConfigForm
        config={{ graphPresetIds: ['preset-2'] }}
        onChange={jest.fn()}
        onTextChange={jest.fn()}
        testRunId="MyApp-acc-loadTest-00001"
      />
    );

    expect(await screen.findByText('Docker CPU')).toBeInTheDocument();
  });
});

describe('ErrorAnalysisConfigForm', () => {
  it('offers the chart, analysis-window and cap controls', async () => {
    const onChange = jest.fn();
    render(
      <ErrorAnalysisConfigForm
        config={{}}
        onChange={onChange}
        onTextChange={jest.fn()}
        testRunId="MyApp-acc-loadTest-00001"
      />
    );

    // Chart and analysis window default on
    expect(screen.getByLabelText(/errors-over-time chart/i)).toBeChecked();
    expect(screen.getByLabelText(/analysis timerange only/i)).toBeChecked();

    fireEvent.click(screen.getByLabelText(/errors-over-time chart/i));
    expect(onChange).toHaveBeenCalledWith({ includeChart: false });
  });

  it('writes the row cap', () => {
    const onChange = jest.fn();
    render(
      <ErrorAnalysisConfigForm
        config={{}}
        onChange={onChange}
        onTextChange={jest.fn()}
        testRunId="MyApp-acc-loadTest-00001"
      />
    );

    fireEvent.change(screen.getByLabelText(/max failing requests/i), { target: { value: '50' } });

    expect(onChange).toHaveBeenCalledWith({ topN: 50 });
  });

  it('tells the author what the section deliberately leaves out', () => {
    render(
      <ErrorAnalysisConfigForm
        config={{}}
        onChange={jest.fn()}
        onTextChange={jest.fn()}
        testRunId="MyApp-acc-loadTest-00001"
      />
    );

    expect(screen.getByText(/response bodies, headers and cookies are never included/i)).toBeInTheDocument();
  });
});
