'use client';

import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { IconButton, Tooltip } from '@mui/material';
import { ContentCopy, Check } from '@mui/icons-material';

interface CopyButtonProps {
  text: string;
  /** Tooltip text before the copy; after a copy it always reads "Copied!". */
  title?: string;
  /** Glyph size in px. The hit area stays >= 24px regardless (WCAG 2.5.8). */
  fontSize?: number;
}

/**
 * Copy-to-clipboard icon button with a transient "Copied!" confirmation.
 *
 * Its own component rather than a helper inside the module that first needed it: a dialog can
 * render eight of these, and ~14 other places under apps/web still hand-roll the same
 * Tooltip + IconButton + `navigator.clipboard.writeText` trio.
 */
export function CopyButton({
  text,
  title = 'Copy to clipboard',
  fontSize = 16,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const revertTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A copy followed within 1.5s by the dialog closing would otherwise leave a pending timer
  // per instance, and DetailLabel renders one of these per field.
  useEffect(
    () => () => {
      if (revertTimer.current) clearTimeout(revertTimer.current);
    },
    [],
  );

  const copy = async (e: MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (revertTimer.current) clearTimeout(revertTimer.current);
      revertTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable (insecure context / denied) — no false confirmation
    }
  };

  return (
    <Tooltip title={copied ? 'Copied!' : title}>
      <IconButton
        size="small"
        onClick={copy}
        sx={{ flexShrink: 0, p: 0.5, minWidth: 24, minHeight: 24 }}
      >
        {copied ? (
          <Check sx={{ fontSize }} color="success" />
        ) : (
          <ContentCopy sx={{ fontSize }} />
        )}
      </IconButton>
    </Tooltip>
  );
}

export default CopyButton;
