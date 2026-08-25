'use client';

import { useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputBase,
  ListSubheader,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from '@mui/material';
import FormatBoldIcon from '@mui/icons-material/FormatBold';
import FormatItalicIcon from '@mui/icons-material/FormatItalic';
import TitleIcon from '@mui/icons-material/Title';
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted';
import FormatListNumberedIcon from '@mui/icons-material/FormatListNumbered';
import LinkIcon from '@mui/icons-material/Link';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import DataObjectIcon from '@mui/icons-material/DataObject';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import CloseFullscreenIcon from '@mui/icons-material/CloseFullscreen';
import {
  renderMarkdown,
  renderPlainText,
  MAX_INLINE_LINK_LABEL_LENGTH,
  REPORT_VARIABLES,
  CONFIG_VARIABLE_GROUP as CONFIG_GROUP,
  type ReportVariable,
} from '@perfana/shared/utils';
import { useReportConfigKeys } from './ReportVariablesProvider';

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
 * markdown BODY structure matches. It is not a full proof: alignment and font size
 * come from sibling controls the report renderer applies around this body, and are
 * not previewed here. Typography deliberately differs too — the preview asks for
 * unstyled output and dresses it via the theme, because the renderer's print styles
 * are light-mode absolutes that would be unreadable in dark mode.
 *
 * SECURITY: unlike every other consumer of report HTML (HtmlReportViewerModal and
 * the public share page both use a sandboxed iframe with scripts disabled), this
 * injects renderer output straight into the app-origin DOM. renderMarkdown's
 * escape-then-transform is therefore load-bearing on its own here. Any new syntax
 * added to it must be re-audited against the invariant test in
 * packages/shared/src/utils/__tests__/markdown.spec.ts.
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

const EXPANDED_ROWS = 18;

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
  // Inert on purpose: this is a proofing surface, not a navigation surface.
  // Clicking your own link here would navigate the dialog away and lose every
  // unsaved section config.
  '& a': { color: 'primary.main', pointerEvents: 'none' },
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
  /** Committed on blur by callers that keep a local draft. */
  onBlur?: () => void;
  maxLength?: number;
  /** Small text beside the label, e.g. a character count. */
  helperText?: string;
  /** Offer the expand-to-modal button. */
  expandable?: boolean;
  /**
   * Sections this text can link to, already slugged by the caller. Empty or
   * absent hides the button — a report with no target sections has nothing to
   * link to, and a disabled button would just raise the question.
   */
  linkTargets?: { title: string; anchor: string }[];
}

export function MarkdownField({
  label,
  value,
  onChange,
  placeholder,
  rows = 6,
  markdown = true,
  onBlur,
  maxLength,
  helperText,
  expandable = true,
  linkTargets,
}: MarkdownFieldProps) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [sectionMenuAnchor, setSectionMenuAnchor] = useState<null | HTMLElement>(null);
  const [variableMenuAnchor, setVariableMenuAnchor] = useState<null | HTMLElement>(null);

  /** Drop literal text in at the caret (replacing any selection), appending if the textarea is gone. */
  const insertAtCaret = (snippet: string) => {
    const el = inputRef.current;
    if (!el) {
      onChange(value + snippet);
      return;
    }
    onChange(value.slice(0, el.selectionStart) + snippet + value.slice(el.selectionEnd));
  };

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
      const lines = (value.slice(lineStart, lineEnd) || tool.sample).split('\n');
      // Toggle off when every selected line already carries THIS tool's marker,
      // so "click again to undo" means the same thing on Heading and the list
      // buttons as it does on Bold. Otherwise apply, replacing any other marker.
      const alreadyApplied = lines.every((line) =>
        tool.key === 'numbers' ? /^\d+[.)]\s+/.test(line) : line.startsWith(tool.prefix),
      );

      inserted = lines
        .map((line, index) => {
          const bare = line.replace(EXISTING_BLOCK_MARKER, '');
          if (alreadyApplied) return bare;
          const marker = tool.key === 'numbers' ? `${index + 1}. ` : tool.prefix;
          return `${marker}${bare}`;
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

  const insertSectionLink = (target: { title: string; anchor: string }) => {
    setSectionMenuAnchor(null);
    // renderMarkdown's link label is capped at MAX_INLINE_LINK_LABEL_LENGTH
    // chars (see packages/shared/src/utils/markdown.ts). A section title is
    // allowed up to 255 (create-report.dto.ts), well past that cap, and a
    // label over the cap doesn't get clipped by the regex — it fails to
    // match as a link AT ALL, so the whole `[title](#anchor)` prints as
    // literal text instead of a link. Truncate comfortably under the cap
    // (not right up against it) so the inserted label always parses.
    const maxLabelLength = Math.floor(MAX_INLINE_LINK_LABEL_LENGTH * 0.8);
    const truncatedTitle =
      target.title.length > maxLabelLength
        ? `${target.title.slice(0, maxLabelLength - 1)}…`
        : target.title;
    // renderMarkdown's link label is `[^\]\n]{1,200}` (see
    // packages/shared/src/utils/markdown.ts) — a raw `]` anywhere in the label
    // ends it, with no backslash-escape support to put it back (the class
    // excludes the literal character outright, escaped or not). A title
    // containing `]` would otherwise insert markdown the regex can't match,
    // so the whole `[title](#anchor)` prints as literal text instead of a
    // link. Swap both brackets for their fullwidth Unicode lookalikes — visibly
    // near-identical, but not the ASCII byte the regex excludes — rather than
    // widening the shared parser (which two other consumers, and its own
    // invariant test suite, would then need re-auditing against).
    const safeLabel = truncatedTitle.replace(/\[/g, '［').replace(/\]/g, '］');
    insertAtCaret(`[${safeLabel}](#${target.anchor})`);
  };

  // Duplicate titles make the menu ambiguous — flag them so authors don't pick
  // the wrong section blind. Comparison is trim+lowercase to match how
  // duplicate-title warnings are surfaced elsewhere in this feature.
  const duplicateTargetTitles = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of linkTargets ?? []) {
      const key = t.title.trim().toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].filter(([, n]) => n > 1).map(([key]) => key);
  }, [linkTargets]);

  // The built-in catalogue plus this test run's own configuration keys, which the
  // renderer resolves under the author's key name exactly as deep links do. Config
  // keys go last: they are the long, install-specific tail nobody scrolls for first.
  const configKeys = useReportConfigKeys();
  const variableGroups = useMemo(() => {
    const groups = new Map<string, ReportVariable[]>();
    for (const variable of REPORT_VARIABLES) {
      groups.set(variable.group, [...(groups.get(variable.group) ?? []), variable]);
    }
    if (configKeys.length > 0) {
      groups.set(
        CONFIG_GROUP,
        configKeys.map((key) => ({
          key,
          label: key,
          // No per-item hint: the group header already says these are this run's
          // configuration, and repeating one identical caption under every key
          // doubled the height of the longest group for zero information.
          hint: '',
          group: CONFIG_GROUP,
        })),
      );
    }
    return [...groups.entries()];
  }, [configKeys]);

  // Memoised: this runs on every keystroke and the parent re-renders every
  // section card when the value propagates.
  const previewHtml = useMemo(
    () =>
      markdown
        ? renderMarkdown(value, { styled: false })
        : renderPlainText(value, { styled: false }),
    [markdown, value],
  );

  const surface = (
    <Box
      sx={{
        border: 1,
        // MUI's own outlined-input border, both modes. Hardcoding the light
        // value paints a near-black border on the #0f172a dark surface.
        borderColor: (t) =>
          t.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.23)' : 'rgba(0, 0, 0, 0.23)',
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
          // Stays visible with markdown off: the formatting buttons go, but the
          // value picker and the expand button still apply to plain text.
          display: 'flex',
          gap: 0.5,
          px: 0.5,
          py: 0.25,
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: 'action.hover',
        }}
      >
        {markdown && TOOLS.map((tool) => (
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

        {markdown && (linkTargets?.length ?? 0) > 0 && (
          <Tooltip title="Link to section" arrow>
            <IconButton
              size="small"
              aria-label="Link to section"
              onClick={(e) => setSectionMenuAnchor(e.currentTarget)}
              onMouseDown={(e) => e.preventDefault()}
            >
              <AccountTreeIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        <Menu
          anchorEl={sectionMenuAnchor}
          open={Boolean(sectionMenuAnchor)}
          onClose={() => setSectionMenuAnchor(null)}
        >
          {duplicateTargetTitles.length > 0 && (
            <Typography
              variant="caption"
              sx={{ display: 'block', px: 2, py: 1, color: 'warning.main' }}
            >
              Sections with a duplicate title: rename them, or a link may open the wrong one.
            </Typography>
          )}
          {(linkTargets ?? []).map((target) => (
            <MenuItem key={target.anchor} onClick={() => insertSectionLink(target)}>
              {target.title}
              {duplicateTargetTitles.includes(target.title.trim().toLowerCase()) && (
                <Typography variant="caption" sx={{ ml: 1, color: 'warning.main' }}>
                  (#{target.anchor})
                </Typography>
              )}
            </MenuItem>
          ))}
        </Menu>

        <Tooltip title="Insert value" arrow>
          <IconButton
            size="small"
            aria-label="Insert value"
            onClick={(e) => setVariableMenuAnchor(e.currentTarget)}
            onMouseDown={(e) => e.preventDefault()}
          >
            <DataObjectIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Menu
          anchorEl={variableMenuAnchor}
          open={Boolean(variableMenuAnchor)}
          onClose={() => setVariableMenuAnchor(null)}
          // The catalogue plus a test run's configuration keys runs well past a
          // screen; cap the list and let it scroll rather than overflow the viewport.
          slotProps={{ paper: { sx: { maxHeight: 420 } } }}
        >
          <Typography
            variant="caption"
            sx={{ display: 'block', px: 2, py: 1, color: 'text.secondary' }}
          >
            Filled in from the test run when the report is rendered.
          </Typography>
          {/* Only while open: MUI does not keep a closed Menu mounted, but the
              element objects were still allocated on every keystroke — three per
              config key, and the config-key tail is unbounded CI-supplied data. */}
          {Boolean(variableMenuAnchor) && variableGroups.map(([group, variables]) => [
            // disableSticky: a sticky subheader parks itself on top of the first
            // item of the group below it as you scroll, hiding that item's label.
            // The type treatment is deliberate — at ListSubheader's defaults these
            // were the same size and colour as the hint caption under every item,
            // so the group boundaries read as one more hint line.
            <ListSubheader
              key={`h-${group}`}
              disableSticky
              sx={{
                lineHeight: 2.4,
                bgcolor: 'background.paper',
                color: 'text.primary',
                fontSize: '0.75rem',
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}
            >
              {group}
            </ListSubheader>,
            ...variables.map((variable) => (
              <MenuItem
                key={variable.key}
                onClick={() => {
                  setVariableMenuAnchor(null);
                  insertAtCaret(`{${variable.key}}`);
                }}
                sx={{ display: 'block', py: 0.75 }}
              >
                <Typography variant="body2">{variable.label}</Typography>
                {variable.hint && (
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {variable.hint}
                  </Typography>
                )}
              </MenuItem>
            )),
          ])}
        </Menu>

        {expandable && (
          <Tooltip title={expanded ? 'Exit full screen' : 'Expand editor'} arrow>
            <IconButton
              size="small"
              aria-label={expanded ? 'Exit full screen' : 'Expand editor'}
              onClick={() => setExpanded(!expanded)}
              onMouseDown={(e) => e.preventDefault()}
              sx={{ ml: 'auto' }}
            >
              {expanded ? <CloseFullscreenIcon fontSize="small" /> : <OpenInFullIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {/* Stacked, never side by side: inline this renders in the report dialog's
          ~650px form column, where two panes would each be ~40 characters wide. */}
      <InputBase
        inputRef={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        multiline
        rows={expanded ? EXPANDED_ROWS : rows}
        placeholder={placeholder}
        inputProps={{ 'aria-label': label, ...(maxLength ? { maxLength } : {}) }}
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
        role="region"
        aria-label={`${label} preview`}
        sx={{ ...PREVIEW_SX, ...(expanded ? { minHeight: 200 } : {}) }}
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
  );

  const caption = (
    <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 0.5 }}>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {label}
      </Typography>
      {helperText && (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {helperText}
        </Typography>
      )}
    </Box>
  );

  // Expanded lives in a modal rather than growing in place: the report dialog's
  // form column is a fixed, already-scrolling ~650px, so growing inline just
  // moves the scrollbar around. The surface is parented to one place at a time,
  // so there is never a second textarea competing for inputRef.
  if (expanded) {
    return (
      <Dialog open fullWidth maxWidth="md" onClose={() => setExpanded(false)}>
        <DialogTitle sx={{ pb: 1 }}>{label}</DialogTitle>
        <DialogContent>{surface}</DialogContent>
        <DialogActions>
          {helperText && (
            <Typography variant="caption" sx={{ color: 'text.secondary', mr: 'auto', ml: 1 }}>
              {helperText}
            </Typography>
          )}
          <Button onClick={() => setExpanded(false)}>Done</Button>
        </DialogActions>
      </Dialog>
    );
  }

  return (
    <Box>
      {caption}
      {surface}
    </Box>
  );
}
