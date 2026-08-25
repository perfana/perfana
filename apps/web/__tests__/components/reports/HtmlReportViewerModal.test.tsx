/**
 * Unit tests for HtmlReportViewerModal's iframe delivery mechanism.
 *
 * Report HTML now contains in-report anchor links (e.g. <a href="#slo-results">).
 * An about:srcdoc document inherits its base URL from the PARENT document, so a
 * fragment link resolves against the app's own URL and navigates the sandboxed
 * iframe away from the report — which then can't render (no allow-scripts) and
 * looks blank/broken.
 *
 * The fix serves the report from a blob: URL instead, which has its own base URL.
 * jsdom cannot exercise real fragment navigation, so these tests assert the
 * mechanism: the iframe gets `src` (a blob URL), never `srcDoc`, the sandbox
 * attribute is untouched, and the blob URL is revoked on unmount.
 */

import React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { HtmlReportViewerModal } from '@/components/reports/HtmlReportViewerModal';

const HTML_CONTENT = '<html><body><a href="#slo-results">Jump</a><h2 id="slo-results">SLO</h2></body></html>';

describe('HtmlReportViewerModal iframe delivery', () => {
  const createObjectURL = jest.fn();
  const revokeObjectURL = jest.fn();

  beforeEach(() => {
    let counter = 0;
    createObjectURL.mockImplementation(() => `blob:https://example.com/fake-${++counter}`);
    // jsdom does not implement these.
    // @ts-expect-error - test stub
    global.URL.createObjectURL = createObjectURL;
    // @ts-expect-error - test stub
    global.URL.revokeObjectURL = revokeObjectURL;
  });

  afterEach(() => {
    jest.clearAllMocks();
    cleanup();
  });

  it('assigns the iframe a blob: src and never sets srcDoc', async () => {
    render(
      <HtmlReportViewerModal
        open
        onClose={jest.fn()}
        htmlContent={HTML_CONTENT}
        reportName="Test Report"
      />
    );

    const iframe = await screen.findByTitle('Report: Test Report');

    // The URL actually returned by the (stubbed) createObjectURL call is what
    // ends up on the element — not just "some blob: string".
    const expectedUrl = createObjectURL.mock.results[0]?.value;
    expect(expectedUrl).toBeTruthy();
    expect(iframe).toHaveAttribute('src', expectedUrl);
    expect(iframe).not.toHaveAttribute('srcdoc');
  });

  it('keeps the sandbox attribute exactly as-is', async () => {
    render(
      <HtmlReportViewerModal
        open
        onClose={jest.fn()}
        htmlContent={HTML_CONTENT}
        reportName="Test Report"
      />
    );

    const iframe = await screen.findByTitle('Report: Test Report');
    expect(iframe).toHaveAttribute('sandbox', 'allow-same-origin allow-popups');
  });

  it('revokes the blob URL on unmount', async () => {
    const { unmount } = render(
      <HtmlReportViewerModal
        open
        onClose={jest.fn()}
        htmlContent={HTML_CONTENT}
        reportName="Test Report"
      />
    );

    const iframe = await screen.findByTitle('Report: Test Report');
    const usedUrl = iframe.getAttribute('src');
    expect(usedUrl).toBeTruthy();

    unmount();

    expect(revokeObjectURL).toHaveBeenCalledWith(usedUrl);
  });

  it('does not render an iframe before the blob URL is ready', () => {
    // No htmlContent yet (still loading) — no iframe, no about:blank src.
    render(
      <HtmlReportViewerModal
        open
        onClose={jest.fn()}
        reportName="Test Report"
      />
    );

    expect(screen.queryByTitle(/^Report:/)).not.toBeInTheDocument();
  });

  it('revokes the blob URL when the viewer closes, even though the component stays mounted', async () => {
    // The retention leak this guards: content supplied via the `htmlContent` prop is
    // deliberately NOT cleared by the reset-on-close effect (so a re-open with the
    // same prop doesn't re-fetch), so the ONLY thing that used to make this URL go
    // away was the content changing or the component unmounting — a reusable host
    // that keeps the viewer mounted across opens got neither.
    const { rerender } = render(
      <HtmlReportViewerModal
        open
        onClose={jest.fn()}
        htmlContent={HTML_CONTENT}
        reportName="Test Report"
      />
    );

    const iframe = await screen.findByTitle('Report: Test Report');
    const usedUrl = iframe.getAttribute('src');
    expect(usedUrl).toBeTruthy();
    expect(revokeObjectURL).not.toHaveBeenCalledWith(usedUrl);

    rerender(
      <HtmlReportViewerModal
        open={false}
        onClose={jest.fn()}
        htmlContent={HTML_CONTENT}
        reportName="Test Report"
      />
    );

    await waitFor(() => {
      expect(revokeObjectURL).toHaveBeenCalledWith(usedUrl);
    });
  });

  it('revokes the previous blob URL when the report content changes', async () => {
    const { rerender } = render(
      <HtmlReportViewerModal
        open
        onClose={jest.fn()}
        htmlContent={HTML_CONTENT}
        reportName="Test Report"
      />
    );

    const iframe = await screen.findByTitle('Report: Test Report');
    const firstUrl = iframe.getAttribute('src');

    rerender(
      <HtmlReportViewerModal
        open
        onClose={jest.fn()}
        htmlContent={HTML_CONTENT + '<!-- changed -->'}
        reportName="Test Report"
      />
    );

    await waitFor(() => {
      expect(revokeObjectURL).toHaveBeenCalledWith(firstUrl);
    });
  });
});
