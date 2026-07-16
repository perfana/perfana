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

  it('commits comment changes on blur, not on every keystroke', () => {
    const onChange = jest.fn();
    render(<Form config={{}} onChange={onChange} />);

    const commentField = screen.getByLabelText(/section comments/i);
    expect(commentField).toBeInTheDocument();

    // Typing keeps the draft local — no parent onChange per keystroke —
    // while the character counter stays live from local state
    fireEvent.change(commentField, { target: { value: 'looks good' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('10 / 2000 characters')).toBeInTheDocument();

    // Blur commits the draft to the parent
    fireEvent.blur(commentField);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ comment: 'looks good' }));
  });

  it('renders a Preview Section button, disabled when no test run is selected', () => {
    render(<Form config={{}} onChange={jest.fn()} />);

    const previewButton = screen.getByRole('button', { name: /preview section/i });
    expect(previewButton).toBeInTheDocument();
    expect(previewButton).toBeDisabled();
  });

  it('opens the preview modal with the correct preview type', async () => {
    render(<Form config={enableConfig} onChange={jest.fn()} testRunId="MyApp-acc-loadTest-00001" />);

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

it('enables the Preview Section button when a testRunId is provided', () => {
  render(<SloConfigForm config={{}} onChange={jest.fn()} testRunId="MyApp-acc-loadTest-00001" />);
  expect(screen.getByRole('button', { name: /preview section/i })).toBeEnabled();
});

it('keeps the Preview Section button disabled for response times until a scenario is chosen', () => {
  render(
    <TransactionResponseTimesConfigForm
      config={{}}
      onChange={jest.fn()}
      testRunId="MyApp-acc-loadTest-00001"
    />
  );
  expect(screen.getByRole('button', { name: /preview section/i })).toBeDisabled();
});

describe('Top10ListsConfigForm', () => {
  it('renders the scope selector and hides includeUrl unless scope is requests', () => {
    render(<Top10ListsConfigForm config={{}} onChange={() => {}} testRunId="tr-1" />);
    expect(screen.getByText(/scope/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/show url/i)).not.toBeInTheDocument();
  });

  it('shows the includeUrl toggle when scope is requests', () => {
    render(<Top10ListsConfigForm config={{ scope: 'requests' }} onChange={() => {}} testRunId="tr-1" />);
    expect(screen.getByLabelText(/show url/i)).toBeInTheDocument();
  });
});
