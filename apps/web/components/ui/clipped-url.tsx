'use client';

import { useState } from 'react';
import { Box, IconButton, Popover, Typography, Tooltip, type SxProps, type Theme } from '@mui/material';
import { Visibility, ContentCopy, Check } from '@mui/icons-material';

/** Clickable icon that opens a popover with the full URL and a copy-to-clipboard button. */
function UrlViewer({ url }: { url: string }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable (insecure context / denied) — nothing to do
    }
  };

  return (
    <>
      <Tooltip title="View full URL">
        <IconButton
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            setAnchor(e.currentTarget);
          }}
          sx={{ p: 0.25, flexShrink: 0 }}
        >
          <Visibility sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Box sx={{ p: 2, maxWidth: 520, display: 'flex', alignItems: 'flex-start', gap: 1 }}>
          <Typography
            variant="body2"
            sx={{ fontFamily: 'monospace', fontSize: '0.75rem', wordBreak: 'break-all' }}
          >
            {url}
          </Typography>
          <Tooltip title={copied ? 'Copied!' : 'Copy to clipboard'}>
            <IconButton size="small" onClick={copy} sx={{ flexShrink: 0 }}>
              {copied ? (
                <Check sx={{ fontSize: 16 }} color="success" />
              ) : (
                <ContentCopy sx={{ fontSize: 16 }} />
              )}
            </IconButton>
          </Tooltip>
        </Box>
      </Popover>
    </>
  );
}

/**
 * Put this on the TableCell that holds a URL — it is what stops one long URL from widening the
 * table. In an auto-layout table a nowrap cell reports its full text width as the column's
 * intrinsic width, so the table grows until the measurements are pushed off screen and
 * `text-overflow: ellipsis` never gets a chance to apply. Declaring a max-width replaces that
 * contribution, and 0 removes it entirely.
 *
 * Use this alone in a table whose header already assigns every column a width — there the
 * percentages decide the layout and a competing `width` from the body only distorts them.
 */
export const URL_CELL_MAX_WIDTH_SX = { maxWidth: 0 } as const;

/**
 * The above plus `width: '100%'`, which hands the column all the space the other columns did not
 * claim, so the URL truncates to the real available width rather than to some guessed pixel count.
 *
 * Use this in a table that declares no column widths of its own, and on at most one cell per row:
 * `width: '100%'` claims the whole leftover budget, so a second cell asking for the same is left
 * with its min-content width and clips its URL to about one character.
 */
export const URL_CELL_SX = { ...URL_CELL_MAX_WIDTH_SX, width: '100%' } as const;

interface ClippedUrlProps {
  url: string;
  /** MUI Typography variant for the clipped text (default 'caption'). */
  variant?: 'caption' | 'body2' | 'body1';
  /** Text color token (default 'text.secondary'). */
  color?: string;
  /** Extra sx merged onto the clipped text. */
  sx?: SxProps<Theme>;
}

/**
 * Single-line, ellipsis-clipped URL followed by a UrlViewer icon (full URL + copy).
 *
 * This fills whatever width its container gives it and imposes no cap of its own — a fixed pixel
 * cap here would truncate mid-URL while most of a wide column sat empty. Constraining is the
 * cell's job: put `URL_CELL_SX` on the TableCell.
 */
export function ClippedUrl({ url, variant = 'caption', color = 'text.secondary', sx }: ClippedUrlProps) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0, width: '100%' }}>
      <Typography
        variant={variant}
        color={color}
        sx={{
          fontFamily: 'monospace',
          fontSize: '0.65rem',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
          minWidth: 0,
          ...sx,
        }}
      >
        {url}
      </Typography>
      <UrlViewer url={url} />
    </Box>
  );
}
