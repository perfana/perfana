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

/** ponytail: one fixed cap for every table; make it a prop if a caller ever needs a wider one. */
const URL_MAX_WIDTH_PX = 360;

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
 * The hard maxWidth is what actually keeps the clipping honest: inside an auto-layout table a
 * nowrap cell contributes its full text width to the column, so `text-overflow: ellipsis` alone
 * lets one long URL widen the table until the measurement columns are pushed off screen. An
 * explicit max-width caps that intrinsic contribution; the eye icon is where the full URL lives.
 */
export function ClippedUrl({ url, variant = 'caption', color = 'text.secondary', sx }: ClippedUrlProps) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0, maxWidth: URL_MAX_WIDTH_PX }}>
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
