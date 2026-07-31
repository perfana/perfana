'use client';

import { useId, useRef } from 'react';
import { Box, IconButton, InputBase, Tooltip, Typography } from '@mui/material';
import FormatBoldIcon from '@mui/icons-material/FormatBold';
import FormatItalicIcon from '@mui/icons-material/FormatItalic';
import TitleIcon from '@mui/icons-material/Title';
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted';
import FormatListNumberedIcon from '@mui/icons-material/FormatListNumbered';
import LinkIcon from '@mui/icons-material/Link';
import { renderMarkdown, renderPlainText } from '@perfana/shared/utils';

/**
 * Markdown input with a formatting toolbar and a live preview.
 *
 * ponytail: the toolbar writes markdown into a plain textarea rather than being a
 * real rich-text editor, so the stored format stays markdown and nothing has to
 * serialise HTML back. Users who don't know the syntax click buttons and read the
 * preview; they never have to type a `*`. Swap in TipTap only if seeing the raw
 * markdown alongside the preview turns out to bother people.
 *
 * The preview runs the same renderMarkdown the API renders the report with, so the
 * STRUCTURE matches the PDF exactly. Typography deliberately does not: the preview
 * asks for unstyled output and dresses it via the theme, because the renderer's
 * print styles are light-mode absolutes that would be unreadable in dark mode.
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

// Theme tokens rather than the renderer's print styles, so the preview stays
// legible in dark mode and matches the surrounding form's type scale.
const PREVIEW_SX = {
  flex: 1,
  p: 1.5,
  minHeight: 96,
  overflow: 'auto',
  fontSize: '0.875rem',
  borderTop: 1,
  borderColor: 'divider',
  bgcolor: 'background.default',
  '& :last-child': { mb: 0 },
  '& p, & ul, & ol': { m: 0, mb: 1 },
  '& ul, & ol': { pl: 2.75 },
  '& h1, & h2, & h3, & h4, & h5, & h6': { m: 0, mb: 0.75, fontWeight: 700 },
  '& h1': { fontSize: '1.25rem' },
  '& h2': { fontSize: '1.05rem' },
  '& h3, & h4, & h5, & h6': { fontSize: '0.9375rem' },
  '& code': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '0.92em',
    bgcolor: 'action.hover',
    color: 'text.primary',
    px: 0.5,
    borderRadius: '3px',
  },
  '& a': { color: 'primary.main' },
  '& [data-placeholder]': { color: 'text.secondary' },
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
  rows = 6,
  markdown = true,
}: MarkdownFieldProps) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const previewId = useId();

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
    } else if ('link' in tool) {
      const selected = value.slice(selectionStart, selectionEnd) || tool.sample;
      const prefix = `[${selected}](`;
      before = value.slice(0, selectionStart);
      after = value.slice(selectionEnd);
      inserted = `${prefix}${LINK_URL_PLACEHOLDER})`;
      // Land on the URL — it's the bit that always needs replacing.
      caretStart = selectionStart + prefix.length;
      caretEnd = caretStart + LINK_URL_PLACEHOLDER.length;
    } else {
      const { wrap } = tool;
      const selected = value.slice(selectionStart, selectionEnd) || tool.sample;

      // Unwrap instead of stacking: a second Bold click on **p95** must not
      // produce ****p95****, which prints literal asterisks in the PDF.
      const wrapped =
        selected.length > wrap.length * 2 &&
        selected.startsWith(wrap) &&
        selected.endsWith(wrap);
      const surrounded =
        value.slice(selectionStart - wrap.length, selectionStart) === wrap &&
        value.slice(selectionEnd, selectionEnd + wrap.length) === wrap;

      if (wrapped) {
        before = value.slice(0, selectionStart);
        after = value.slice(selectionEnd);
        inserted = selected.slice(wrap.length, -wrap.length);
        caretStart = selectionStart;
        caretEnd = selectionStart + inserted.length;
      } else if (surrounded) {
        before = value.slice(0, selectionStart - wrap.length);
        after = value.slice(selectionEnd + wrap.length);
        inserted = selected;
        caretStart = selectionStart - wrap.length;
        caretEnd = caretStart + inserted.length;
      } else {
        before = value.slice(0, selectionStart);
        after = value.slice(selectionEnd);
        inserted = `${wrap}${selected}${wrap}`;
        caretStart = selectionStart + wrap.length;
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

  const previewHtml = markdown
    ? renderMarkdown(value, { styled: false })
    : renderPlainText(value, { styled: false });

  return (
    <Box>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>
        {label}
      </Typography>

      <Box
        sx={{
          border: 1,
          borderColor: 'rgba(0, 0, 0, 0.23)',
          borderRadius: 1,
          overflow: 'hidden',
          '&:hover': { borderColor: 'text.primary' },
          '&:focus-within': {
            borderColor: 'primary.main',
            boxShadow: (t) => `0 0 0 1px ${t.palette.primary.main}`,
          },
        }}
      >
        <Box
          role="toolbar"
          aria-label={`${label} formatting`}
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

        {/* Stacked, never side by side: this renders in the report dialog's ~650px
            form column, where two panes would each be ~40 characters wide. */}
        <InputBase
          inputRef={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          multiline
          rows={rows}
          placeholder={placeholder}
          inputProps={{ 'aria-label': label, 'aria-describedby': previewId }}
          sx={{
            display: 'flex',
            width: '100%',
            alignItems: 'flex-start',
            p: 1.5,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: '0.875rem',
          }}
        />

        <Box
          id={previewId}
          role="region"
          aria-label={`${label} preview`}
          sx={PREVIEW_SX}
          // Safe without a sanitizer: both renderers escape the whole source before
          // emitting their first tag, so no author HTML can reach the DOM. Covered
          // by packages/shared/src/utils/__tests__/markdown.spec.ts.
          dangerouslySetInnerHTML={{
            __html:
              value.trim().length > 0
                ? previewHtml
                : '<p data-placeholder="true">Preview appears here as you type</p>',
          }}
        />
      </Box>
    </Box>
  );
}
