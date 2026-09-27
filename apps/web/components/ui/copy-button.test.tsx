/**
 * CopyButton was extracted out of UrlViewer so the error-details dialog can put the same
 * affordance beside every field label. Three things have to hold for both call sites:
 * the transient "Copied!" confirmation reverts, a denied clipboard is swallowed rather than
 * leaving a permanent confirmation, and the click never reaches the row underneath.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { CopyButton } from './copy-button';
import { ClippedUrl } from './clipped-url';

// MUI's Tooltip mirrors a string title onto the child's aria-label, so the accessible name
// doubles as an assertion on which of the two icon states is showing.
const setClipboard = (writeText: jest.Mock) =>
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

const click = async (name: string) => {
  await act(async () => {
    fireEvent.click(screen.getByLabelText(name));
  });
};

describe('CopyButton', () => {
  afterEach(() => {
    jest.useRealTimers();
    // jsdom has no clipboard of its own, so a stub left behind would be inherited by every
    // later test in the run — including one that means to assert a DENIED clipboard.
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('copies the text, confirms, and reverts after 1.5s', async () => {
    jest.useFakeTimers();
    const writeText = jest.fn().mockResolvedValue(undefined);
    setClipboard(writeText);

    render(<CopyButton text="https://api.example.com/checkout" />);

    await click('Copy to clipboard');

    expect(writeText).toHaveBeenCalledWith('https://api.example.com/checkout');
    expect(screen.getByLabelText('Copied!')).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(1500);
    });

    expect(screen.getByLabelText('Copy to clipboard')).toBeInTheDocument();
  });

  it('swallows a denied clipboard instead of confirming a copy that did not happen', async () => {
    const writeText = jest.fn().mockRejectedValue(new Error('NotAllowedError'));
    setClipboard(writeText);

    render(<CopyButton text="anything" title="Copy url" />);

    await click('Copy url');

    expect(screen.queryByLabelText('Copied!')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Copy url')).toBeInTheDocument();
  });

  it('does not bubble its click to an enclosing row handler', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    const onRowClick = jest.fn();

    render(
      <div onClick={onRowClick}>
        <CopyButton text="anything" title="Copy url" />
      </div>,
    );

    await click('Copy url');

    expect(writeText).toHaveBeenCalled();
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('leaves no pending revert timer when it unmounts inside the 1.5s window', async () => {
    jest.useFakeTimers();
    const writeText = jest.fn().mockResolvedValue(undefined);
    setClipboard(writeText);

    const { unmount } = render(<CopyButton text="anything" title="Copy url" />);
    await click('Copy url');
    expect(jest.getTimerCount()).toBe(1);

    unmount();

    expect(jest.getTimerCount()).toBe(0);
  });

  it('still backs the full-URL popover it was extracted from', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    setClipboard(writeText);

    render(<ClippedUrl url="https://api.example.com/very/long/path?id=42" />);

    fireEvent.click(screen.getByLabelText('View full URL'));
    await click('Copy to clipboard');

    expect(writeText).toHaveBeenCalledWith('https://api.example.com/very/long/path?id=42');
  });
});
