'use client';

import { useRef } from 'react';
import { Box, IconButton, InputBase, Tooltip, Typography } from '@mui/material';
import FormatBoldIcon from '@mui/icons-material/FormatBold';
import FormatItalicIcon from '@mui/icons-material/FormatItalic';
import TitleIcon from '@mui/icons-material/Title';
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted';
import FormatListNumberedIcon from '@mui/icons-material/FormatListNumbered';
import LinkIcon from '@mui/icons-material/Link';
import { renderMarkdown } from '@perfana/shared/utils';

/**
 * Markdown input with a formatting toolbar and a live preview.
 *
 * ponytail: the toolbar writes markdown into a plain textarea rather than being a
 * real rich-text editor, so the stored format stays markdown and nothing has to
 * serialise HTML back. Users who don't know the syntax click buttons and read the
 * preview; they never have to type a `*`. Swap in TipTap only if seeing the raw
 * markdown alongside the preview turns out to bother people.
 *
 * The preview uses the same renderMarkdown the API renders the report with, so
 * what you see here is what lands in the PDF.
 */

const TOOLS = [
  { key: 'bold', title: 'Bold', Icon: FormatBoldIcon, wrap: '**', sample: 'bold text' },
  { key: 'italic', title: 'Italic', Icon: FormatItalicIcon, wrap: '*', sample: 'italic text' },
  { key: 'heading', title: 'Heading', Icon: TitleIcon, prefix: '## ', sample: 'Heading' },
  {
    key: 'bullets',
    title: 'Bulleted list',
    Icon: FormatListBulletedIcon,
    prefix: '- ',
    sample: 'List item',
  },
  {
    key: 'numbers',
    title: 'Numbered list',
    Icon: FormatListNumberedIcon,
    prefix: '1. ',
    sample: 'List item',
  },
  { key: 'link', title: 'Link', Icon: LinkIcon, link: true, sample: 'link text' },
] as const;

type Tool = (typeof TOOLS)[number];

// Clicking a block button twice should re-format the line, not stack markers on it.
const EXISTING_BLOCK_MARKER = /^(#{1,6}\s+|[-*]\s+|\d+[.)]\s+)/;

const LINK_URL_PLACEHOLDER = 'https://';

const PREVIEW_SX = {
  flex: 1,
  p: 1.5,
  minHeight: 120,
  overflow: 'auto',
  fontSize: 13,
  borderLeft: { md: 1 },
  borderTop: { xs: 1, md: 0 },
  borderColor: 'divider',
  bgcolor: 'background.default',
  '& :last-child': { mb: 0 },
} as const;

interface MarkdownFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  /** Mirrors the renderer's "Enable Markdown" switch. Off = plain text, toolbar hidden. */
  markdown?: boolean;
}

export function MarkdownField({
  label,
  value,
  onChange,
  placeholder,
  rows = 8,
  markdown = true,
}: MarkdownFieldProps) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const applyTool = (tool: Tool) => {
    const el = inputRef.current;
    if (!el) return;

    const selectionStart = el.selectionStart;
    const selectionEnd = el.selectionEnd;

    let before: string;
    let inserted: string;
    let after: string;
    let caretStart: number;
    let caretEnd: number;

    if ('prefix' in tool) {
      // Block markers apply to whole lines, so grow the selection to line boundaries.
      const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
      const nextBreak = value.indexOf('\n', selectionEnd);
      const lineEnd = nextBreak === -1 ? value.length : nextBreak;

      before = value.slice(0, lineStart);
      after = value.slice(lineEnd);
      inserted = (value.slice(lineStart, lineEnd) || tool.sample)
        .split('\n')
        .map((line, index) => {
          const marker = tool.key === 'numbers' ? `${index + 1}. ` : tool.prefix;
          return `${marker}${line.replace(EXISTING_BLOCK_MARKER, '')}`;
        })
        .join('\n');

      caretStart = lineStart;
      caretEnd = lineStart + inserted.length;
    } else {
      const selected = value.slice(selectionStart, selectionEnd) || tool.sample;
      before = value.slice(0, selectionStart);
      after = value.slice(selectionEnd);

      if ('link' in tool) {
        inserted = `[${selected}](${LINK_URL_PLACEHOLDER})`;
        // Land on the URL — it's the bit that always needs replacing.
        caretStart = selectionStart + selected.length + 3;
        caretEnd = caretStart + LINK_URL_PLACEHOLDER.length;
      } else {
        inserted = `${tool.wrap}${selected}${tool.wrap}`;
        caretStart = selectionStart + tool.wrap.length;
        caretEnd = caretStart + selected.length;
      }
    }

    onChange(`${before}${inserted}${after}`);

    // ponytail: rAF instead of a layout effect — the value round-trips through the
    // parent, so the textarea only holds the new text after React commits.
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caretStart, caretEnd);
    });
  };

  return (
    <Box>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>
        {label}
      </Typography>

      <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
        <Box
          sx={{
            display: markdown ? 'flex' : 'none',
            gap: 0.5,
            px: 0.5,
            py: 0.25,
            borderBottom: 1,
            borderColor: 'divider',
            bgcolor: 'action.hover',
          }}
        >
          {TOOLS.map((tool) => (
            <Tooltip key={tool.key} title={tool.title} arrow>
              <IconButton
                size="small"
                aria-label={tool.title}
                onClick={() => applyTool(tool)}
                // Keep the textarea selection alive — mousedown would blur it first.
                onMouseDown={(e) => e.preventDefault()}
              >
                <tool.Icon fontSize="small" />
              </IconButton>
            </Tooltip>
          ))}
        </Box>

        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' } }}>
          <InputBase
            inputRef={inputRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            multiline
            rows={rows}
            placeholder={placeholder}
            sx={{
              flex: 1,
              alignItems: 'flex-start',
              p: 1.5,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 13,
            }}
          />

          {markdown ? (
            <Box
              aria-label={`${label} preview`}
              sx={PREVIEW_SX}
              // Safe without a sanitizer: renderMarkdown escapes the whole source before
              // emitting its first tag, so no author HTML can reach the DOM. Covered by
              // packages/shared/src/utils/__tests__/markdown.spec.ts.
              dangerouslySetInnerHTML={{
                __html:
                  renderMarkdown(value) ||
                  '<span style="opacity:0.5">Preview appears here as you type</span>',
              }}
            />
          ) : (
            // Markdown off: React escapes the text for us, so the preview matches the
            // renderer's escapeHtml + pre-wrap branch exactly.
            <Box
              aria-label={`${label} preview`}
              sx={{ ...PREVIEW_SX, whiteSpace: 'pre-wrap' }}
            >
              {value || (
                <Box component="span" sx={{ opacity: 0.5 }}>
                  Preview appears here as you type
                </Box>
              )}
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}

export default MarkdownField;
