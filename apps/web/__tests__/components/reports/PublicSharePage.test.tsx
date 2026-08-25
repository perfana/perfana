/**
 * Unit tests for the public share page's iframe delivery mechanism.
 *
 * Same bug/fix as HtmlReportViewerModal: about:srcdoc inherits the PARENT
 * document's base URL, so an in-report <a href="#slo-results"> link navigates
 * the sandboxed iframe off the report instead of scrolling to a fragment.
 * The fix serves the report from a blob: URL, which owns its base URL.
 *
 * jsdom cannot exercise real fragment navigation, so these tests assert the
 * mechanism: `src` is a blob URL, `srcDoc` is never set, the sandbox attribute
 * is untouched, and the blob URL is revoked on unmount.
 */

import React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('next/navigation', () => ({
  useParams: () => ({ shareId: 'share-abc-123' }),
}));

jest.mock('@/lib/api/reports', () => ({
  getPublicReport: jest.fn(),
}));

import PublicSharePage from '@/app/reports/share/[shareId]/page';
import { getPublicReport } from '@/lib/api/reports';

const REPORT_DATA = {
  html_content: '<html><body><a href="#slo-results">Jump</a><h2 id="slo-results">SLO</h2></body></html>',
  name: 'Shared Report',
  generated_at: '2026-08-01T00:00:00.000Z',
};

describe('PublicSharePage iframe delivery', () => {
  const createObjectURL = jest.fn();
  const revokeObjectURL = jest.fn();

  beforeEach(() => {
    let counter = 0;
    createObjectURL.mockImplementation(() => `blob:https://example.com/share-fake-${++counter}`);
    // @ts-expect-error - test stub
    global.URL.createObjectURL = createObjectURL;
    // @ts-expect-error - test stub
    global.URL.revokeObjectURL = revokeObjectURL;
    (getPublicReport as jest.Mock).mockResolvedValue(REPORT_DATA);
  });

  afterEach(() => {
    jest.clearAllMocks();
    cleanup();
  });

  it('assigns the iframe a blob: src and never sets srcDoc', async () => {
    render(<PublicSharePage />);

    const iframe = await screen.findByTitle('Report: Shared Report');

    const expectedUrl = createObjectURL.mock.results[0]?.value;
    expect(expectedUrl).toBeTruthy();
    expect(iframe).toHaveAttribute('src', expectedUrl);
    expect(iframe).not.toHaveAttribute('srcdoc');
  });

  it('keeps the sandbox attribute exactly as-is', async () => {
    render(<PublicSharePage />);

    const iframe = await screen.findByTitle('Report: Shared Report');
    expect(iframe).toHaveAttribute('sandbox', 'allow-same-origin allow-popups');
  });

  it('revokes the blob URL on unmount', async () => {
    const { unmount } = render(<PublicSharePage />);

    const iframe = await screen.findByTitle('Report: Shared Report');
    const usedUrl = iframe.getAttribute('src');
    expect(usedUrl).toBeTruthy();

    unmount();

    expect(revokeObjectURL).toHaveBeenCalledWith(usedUrl);
  });

  it('does not render an iframe before the blob URL is ready', () => {
    // Report fetch is still pending — no iframe, no about:blank src.
    (getPublicReport as jest.Mock).mockReturnValue(new Promise(() => {}));
    render(<PublicSharePage />);

    expect(screen.queryByTitle(/^Report:/)).not.toBeInTheDocument();
  });

  it('revokes the previous blob URL when the report content changes', async () => {
    render(<PublicSharePage />);

    const iframe = await screen.findByTitle('Report: Shared Report');
    const firstUrl = iframe.getAttribute('src');

    (getPublicReport as jest.Mock).mockResolvedValue({
      ...REPORT_DATA,
      html_content: REPORT_DATA.html_content + '<!-- changed -->',
    });

    const refreshButton = screen.getByRole('button', { name: /refresh report/i });
    refreshButton.click();

    await waitFor(() => {
      expect(revokeObjectURL).toHaveBeenCalledWith(firstUrl);
    });
  });
});
