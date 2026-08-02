import { render, screen, waitFor } from '@testing-library/react';
import HtmlSectionPreview from './HtmlSectionPreview';
import { previewSection } from '@/lib/api/reports';

jest.mock('@/lib/api/reports', () => ({
  previewSection: jest.fn(),
}));

const mockPreviewSection = previewSection as jest.Mock;

describe('HtmlSectionPreview', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows the loading state while the preview is being fetched', () => {
    // Never-resolving promise keeps the component in its loading state
    mockPreviewSection.mockReturnValue(new Promise(() => {}));

    render(<HtmlSectionPreview testRunId="run-1" sectionType="slo" config={{}} />);

    expect(screen.getByText(/loading preview from backend/i)).toBeInTheDocument();
  });

  it('renders the resolved HTML in a fully sandboxed iframe and sends text at the section level', async () => {
    // The previous test leaves a never-resolving mock implementation behind
    // (jest.clearAllMocks() only clears call records, not implementations).
    mockPreviewSection.mockResolvedValue('<p>Hello preview</p>');

    render(
      <HtmlSectionPreview
        testRunId="run-1"
        sectionType="slo"
        config={{ maxItems: 5 }}
        text="my observation"
      />,
    );

    await waitFor(() => expect(previewSection).toHaveBeenCalled());

    expect(previewSection).toHaveBeenCalledWith(
      {
        type: 'slo',
        order: 0,
        text: 'my observation',
        config: { maxItems: 5 },
      },
      'run-1',
      undefined,
      expect.anything(),
    );

    const iframe = document.querySelector('iframe');
    expect(iframe).toHaveAttribute('sandbox', '');
  });

  it('shows an error Alert with recovery guidance when the preview fails', async () => {
    mockPreviewSection.mockRejectedValue(
      new Error(`<html><body><h1>Internal Server Error</h1>${'x'.repeat(500)}</body></html>`)
    );

    render(<HtmlSectionPreview testRunId="run-1" sectionType="trends" config={{}} />);

    expect(await screen.findByText(/error loading preview/i)).toBeInTheDocument();
    expect(
      screen.getByText(/adjust the section configuration or select a test run, then reopen the preview/i)
    ).toBeInTheDocument();
    // Success copy must NOT appear in the failure branch
    expect(screen.queryByText(/exact html/i)).not.toBeInTheDocument();

    // Long HTML error dumps are tag-stripped and truncated to ~200 chars
    const alert = screen.getByRole('alert');
    expect(alert.textContent).not.toContain('<html>');
    expect(alert.textContent).toContain('Internal Server Error');
    const messageNode = screen.getByText(/internal server error/i);
    expect((messageNode.textContent ?? '').length).toBeLessThanOrEqual(201);
  });

  it('does not refetch when re-rendered with a structurally equal but new config object', async () => {
    mockPreviewSection.mockResolvedValue('<p>stable</p>');

    const { rerender } = render(
      <HtmlSectionPreview testRunId="run-1" sectionType="slo" config={{ maxItems: 5 }} />
    );

    await screen.findByTitle('Section Preview');
    expect(mockPreviewSection).toHaveBeenCalledTimes(1);

    // Fresh object identity, identical content — must NOT trigger a refetch
    rerender(<HtmlSectionPreview testRunId="run-1" sectionType="slo" config={{ maxItems: 5 }} />);

    await waitFor(() => {
      expect(mockPreviewSection).toHaveBeenCalledTimes(1);
    });

    // Sanity check: a content change DOES refetch
    rerender(<HtmlSectionPreview testRunId="run-1" sectionType="slo" config={{ maxItems: 10 }} />);

    await waitFor(() => {
      expect(mockPreviewSection).toHaveBeenCalledTimes(2);
    });
  });

  it('refetches when re-rendered with a changed text prop and an unchanged config', async () => {
    // Guards against `text` being dropped from the effect's dependency array,
    // which would silently stop the preview from refreshing when text is edited.
    mockPreviewSection.mockResolvedValue('<p>stable</p>');

    const { rerender } = render(
      <HtmlSectionPreview testRunId="run-1" sectionType="slo" config={{ maxItems: 5 }} text="first" />
    );

    await screen.findByTitle('Section Preview');
    expect(mockPreviewSection).toHaveBeenCalledTimes(1);

    // Same config content, changed text — MUST trigger a refetch
    rerender(<HtmlSectionPreview testRunId="run-1" sectionType="slo" config={{ maxItems: 5 }} text="second" />);

    await waitFor(() => {
      expect(mockPreviewSection).toHaveBeenCalledTimes(2);
    });

    expect(previewSection).toHaveBeenLastCalledWith(
      {
        type: 'slo',
        order: 0,
        text: 'second',
        config: { maxItems: 5 },
      },
      'run-1',
      undefined,
      expect.anything(),
    );
  });
});
