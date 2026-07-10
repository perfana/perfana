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
} from './SectionConfigs';

// Mock authenticatedFetch so data-fetching effects don't blow up in tests
jest.mock('@/lib/api', () => ({
  authenticatedFetch: jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) })),
}));

// Common shape shared by every section config form
type AnyConfigForm = React.ComponentType<{
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  testRunId?: string;
}>;

const FORMS: [string, AnyConfigForm][] = [
  ['HeaderConfigForm', HeaderConfigForm as unknown as AnyConfigForm],
  ['TextBlockConfigForm', TextBlockConfigForm as unknown as AnyConfigForm],
  ['SloConfigForm', SloConfigForm as unknown as AnyConfigForm],
  ['ApdexConfigForm', ApdexConfigForm as unknown as AnyConfigForm],
  ['TransactionResponseTimesConfigForm', TransactionResponseTimesConfigForm as unknown as AnyConfigForm],
  ['RegressionsConfigForm', RegressionsConfigForm as unknown as AnyConfigForm],
  ['GraphsConfigForm', GraphsConfigForm as unknown as AnyConfigForm],
  ['AwrConfigForm', AwrConfigForm as unknown as AnyConfigForm],
  ['TrendsConfigForm', TrendsConfigForm as unknown as AnyConfigForm],
  ['ComparisonsConfigForm', ComparisonsConfigForm as unknown as AnyConfigForm],
];

describe.each(FORMS)('%s (shared section config affordances)', (_name, Form) => {
  it('renders a Section Comments field and propagates comment changes via onChange', () => {
    const onChange = jest.fn();
    render(<Form config={{}} onChange={onChange} />);

    const commentField = screen.getByLabelText(/section comments/i);
    expect(commentField).toBeInTheDocument();

    fireEvent.change(commentField, { target: { value: 'looks good' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ comment: 'looks good' }));
  });

  it('renders a Preview Section button, disabled when no test run is selected', () => {
    render(<Form config={{}} onChange={jest.fn()} />);

    const previewButton = screen.getByRole('button', { name: /preview section/i });
    expect(previewButton).toBeInTheDocument();
    expect(previewButton).toBeDisabled();
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
