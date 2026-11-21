'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Checkbox from '@mui/material/Checkbox';
import CircularProgress from '@mui/material/CircularProgress';
import FormControlLabel from '@mui/material/FormControlLabel';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import { COMMENT_TAGS, isCommentTag, type CommentCardKey, type CommentTag } from '@perfana/shared/constants/comment-cards';
import { fetchCommentThreads, formatCommentTime, type RunCommentThread } from '@/lib/test-run-comments';
import ExpandableCardHeader from '../shared/ExpandableCardHeader';
import { CARD_LABELS, PAGE_ORDER, useComments } from '../comments/CommentsContext';
import { CommentTagChip } from '../comments/CommentTagChip';
import CommentAuthor from '../comments/CommentAuthor';

const tagOf = (t: { tag?: unknown }): CommentTag | null => (isCommentTag(t.tag) ? t.tag : null);
/** What the root is on: its item, or its marker number on Graphs. */
const anchorOf = (t: RunCommentThread): string | null =>
  t.itemLabel ?? (t.markerSeq != null ? `Marker ${t.markerSeq}` : null);
const newestFirst = (a: RunCommentThread, b: RunCommentThread) => Date.parse(b.createdAt) - Date.parse(a.createdAt);

/**
 * Every root on the run, fetched while `enabled` (the card is expanded) and kept current from the
 * page's comment events, with the drawer's semantics but across every card.
 */
function useRunThreads(enabled: boolean) {
  const ctx = useComments();
  const runId = ctx?.runId;
  const [threads, setThreads] = useState<RunCommentThread[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Events up to the fetch are already in its answer; only later ones are applied.
  const seqAtFetch = useRef(0);
  const lastEventRef = useRef(ctx?.lastEvent);
  lastEventRef.current = ctx?.lastEvent;

  useEffect(() => {
    if (!runId || !enabled) {
      setThreads(null);
      return;
    }
    let live = true;
    setError(null);
    seqAtFetch.current = lastEventRef.current?.seq ?? 0;
    fetchCommentThreads(runId)
      .then((r) => live && setThreads(r.threads))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : 'Loading comments failed'));
    return () => {
      live = false;
    };
  }, [runId, enabled]);

  const lastEvent = ctx?.lastEvent;
  useEffect(() => {
    if (!lastEvent || lastEvent.seq <= seqAtFetch.current) return;
    const c = lastEvent.comment;
    setThreads((prev) => {
      if (!prev) return prev;
      if (lastEvent.type === 'comment:deleted' && 'hardDeleted' in c && c.hardDeleted) {
        return prev.filter((t) => t.id !== c.id).map((t) => ({ ...t, replies: t.replies.filter((r) => r.id !== c.id) }));
      }
      if (lastEvent.type === 'comment:created') {
        if (prev.some((t) => t.id === c.id || t.replies.some((r) => r.id === c.id))) return prev;
        if (!c.parentId) return [...prev, { ...c, replies: [] }];
        return prev.map((t) => (t.id === c.parentId ? { ...t, replies: [...t.replies, c] } : t));
      }
      return prev.map((t) =>
        t.id === c.id ? { ...t, ...c } : { ...t, replies: t.replies.map((r) => (r.id === c.id ? c : r)) },
      );
    });
  }, [lastEvent]);

  return { threads, error };
}

interface Filters {
  tags: CommentTag[];
  card: CommentCardKey | '';
  author: string;
  markersOnly: boolean;
}
const NO_FILTERS: Filters = { tags: [], card: '', author: '', markersOnly: false };

/**
 * The run-wide Comments card (design: docs/designs/test-run-analysis-stories.md, "The comments
 * card"). Lists every root on the run, newest first, with client-side filters and a "Show in
 * context" that does what the `?card=&comment=` deep link does. Not itself commentable, hidden
 * while the run has no comments, and opening it marks nothing seen.
 *
 * The tab bar holds one tab for now; the Stories tab joins it.
 */
export default function CommentsCard({ expanded, onExpand }: { expanded: boolean; onExpand: () => void }) {
  const ctx = useComments();
  const total = Object.values(ctx?.counts ?? {}).reduce((a, c) => a + (c?.total ?? 0), 0);
  const { threads, error } = useRunThreads(expanded && total > 0);
  const [tab, setTab] = useState(0);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);

  const sorted = useMemo(() => (threads ? [...threads].sort(newestFirst) : []), [threads]);
  const options = useMemo(() => {
    const tags = new Set(sorted.map(tagOf).filter((t): t is CommentTag => t !== null));
    const cards = new Set(sorted.map((t) => t.cardKey));
    return {
      tags: COMMENT_TAGS.filter((t) => tags.has(t)),
      cards: PAGE_ORDER.filter((c) => cards.has(c)),
      authors: [...new Set(sorted.map((t) => t.authorName))].sort((a, b) => a.localeCompare(b)),
    };
  }, [sorted]);
  const shown = useMemo(
    () =>
      sorted.filter((t) => {
        const tag = tagOf(t);
        if (filters.tags.length && (!tag || !filters.tags.includes(tag))) return false;
        if (filters.card && t.cardKey !== filters.card) return false;
        if (filters.author && t.authorName !== filters.author) return false;
        if (filters.markersOnly && t.markerSeq == null) return false;
        return true;
      }),
    [sorted, filters],
  );
  const filtered = filters.tags.length > 0 || !!filters.card || !!filters.author || filters.markersOnly;
  const toggleTag = (tag: CommentTag) =>
    setFilters((f) => ({ ...f, tags: f.tags.includes(tag) ? f.tags.filter((t) => t !== tag) : [...f.tags, tag] }));

  if (!ctx || total === 0) return null;

  const perCard = PAGE_ORDER.filter((c) => (ctx.counts[c]?.total ?? 0) > 0);

  return (
    <Box sx={{ gridColumn: expanded ? '1 / -1' : 'auto', height: expanded ? 'auto' : '293px', minWidth: 0 }}>
      <Card
        tabIndex={-1}
        elevation={0}
        data-testid={expanded ? 'comments-card-expanded' : 'comments-card-collapsed'}
        sx={{
          cursor: expanded ? 'default' : 'pointer',
          height: expanded ? 'auto' : '293px',
          borderRadius: 3,
          bgcolor: 'background.paper',
          borderTop: expanded ? 'none' : '3px solid',
          borderTopColor: 'primary.main',
          boxShadow: (theme) => theme.shadows[1],
          overflow: expanded ? 'visible' : 'hidden',
        }}
        onClick={expanded ? undefined : onExpand}
      >
        <CardContent sx={{ p: expanded ? 2 : 3.5, pt: expanded ? 2 : 4, '&:last-child': { pb: expanded ? 2 : 3.5 } }}>
          <ExpandableCardHeader title="Comments" expanded={expanded} onToggle={onExpand} />

          {!expanded && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Typography variant="h4" component="p" sx={{ fontWeight: 600, textAlign: 'center' }}>
                {total}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
                {total === 1 ? 'comment' : 'comments'}
                {ctx.totalUnread > 0 ? ` · ${ctx.totalUnread} unread` : ''}
              </Typography>
              <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0, mt: 1 }}>
                {perCard.slice(0, 4).map((c) => (
                  <Box component="li" key={c} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, py: 0.25 }}>
                    <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>{CARD_LABELS[c]}</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {ctx.counts[c]?.total}
                    </Typography>
                  </Box>
                ))}
                {perCard.length > 4 && (
                  <Typography component="li" variant="caption" color="text.secondary">
                    and {perCard.length - 4} more {perCard.length - 4 === 1 ? 'card' : 'cards'}
                  </Typography>
                )}
              </Box>
            </Box>
          )}

          {expanded && (
            <Box sx={{ mt: 1 }}>
              <Tabs value={tab} onChange={(_, v: number) => setTab(v)} aria-label="Comments views" sx={{ minHeight: 40, mb: 1.5 }}>
                <Tab label="All comments" id="comments-card-tab-all" aria-controls="comments-card-panel-all" sx={{ minHeight: 40, textTransform: 'none' }} />
              </Tabs>
              <Box role="tabpanel" id="comments-card-panel-all" aria-labelledby="comments-card-tab-all">
                {error && <Alert severity="error">{error}</Alert>}
                {!error && !threads && (
                  <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                    <CircularProgress size={24} aria-label="Loading comments" />
                  </Box>
                )}
                {threads && (
                  <>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
                      {options.tags.length > 0 && (
                        <Box role="group" aria-label="Filter by tag" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                          {options.tags.map((t) => (
                            <CommentTagChip key={t} tag={t} selected={filters.tags.includes(t)} onClick={() => toggleTag(t)} />
                          ))}
                        </Box>
                      )}
                      <TextField
                        select
                        size="small"
                        label="Card"
                        value={filters.card}
                        onChange={(e) => setFilters((f) => ({ ...f, card: e.target.value as CommentCardKey | '' }))}
                        SelectProps={{ native: true }}
                        InputLabelProps={{ shrink: true }}
                        sx={{ minWidth: 160, maxWidth: '100%' }}
                      >
                        <option value="">All cards</option>
                        {options.cards.map((c) => (
                          <option key={c} value={c}>{CARD_LABELS[c]}</option>
                        ))}
                      </TextField>
                      <TextField
                        select
                        size="small"
                        label="Author"
                        value={filters.author}
                        onChange={(e) => setFilters((f) => ({ ...f, author: e.target.value }))}
                        SelectProps={{ native: true }}
                        InputLabelProps={{ shrink: true }}
                        sx={{ minWidth: 160, maxWidth: '100%' }}
                      >
                        <option value="">All authors</option>
                        {options.authors.map((a) => (
                          <option key={a} value={a}>{a}</option>
                        ))}
                      </TextField>
                      <FormControlLabel
                        control={
                          <Checkbox
                            size="small"
                            checked={filters.markersOnly}
                            onChange={(e) => setFilters((f) => ({ ...f, markersOnly: e.target.checked }))}
                          />
                        }
                        label="Markers only"
                      />
                      {filtered && (
                        <Button size="small" onClick={() => setFilters(NO_FILTERS)}>
                          Clear filters
                        </Button>
                      )}
                    </Box>
                    <Typography variant="caption" color="text.secondary" component="p" role="status" sx={{ mb: 1 }}>
                      {shown.length} of {sorted.length} {sorted.length === 1 ? 'comment' : 'comments'}
                    </Typography>
                    {shown.length === 0 ? (
                      <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                        {sorted.length === 0 ? 'No comments on this run.' : 'No comments match these filters.'}
                      </Typography>
                    ) : (
                      <Box component="ul" aria-label="All comments" sx={{ listStyle: 'none', p: 0, m: 0 }}>
                        {shown.map((t) => (
                          <CommentRow
                            key={t.id}
                            thread={t}
                            tagSelected={(tag) => filters.tags.includes(tag)}
                            onTag={toggleTag}
                            onShow={() => ctx.showComment(t.cardKey, t.id)}
                          />
                        ))}
                      </Box>
                    )}
                  </>
                )}
              </Box>
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}

function CommentRow({
  thread: t,
  tagSelected,
  onTag,
  onShow,
}: {
  thread: RunCommentThread;
  tagSelected: (tag: CommentTag) => boolean;
  onTag: (tag: CommentTag) => void;
  onShow: () => void;
}) {
  const tag = tagOf(t);
  const anchor = anchorOf(t);
  const card = CARD_LABELS[t.cardKey] ?? t.cardKey;
  const where = anchor ? `${card} · ${anchor}` : card;
  return (
    <Box
      component="li"
      data-testid="comments-card-row"
      data-comment-id={t.id}
      sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 1, py: 1.25, borderTop: 1, borderColor: 'divider' }}
    >
      <Box sx={{ flex: '1 1 280px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1, rowGap: 0.5, minWidth: 0 }}>
          {tag && (
            <CommentTagChip
              tag={tag}
              selected={tagSelected(tag)}
              onClick={() => onTag(tag)}
            />
          )}
          <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere', minWidth: 0 }}>{card}</Typography>
          {anchor && (
            <Typography variant="body2" sx={{ color: 'readable.primary', fontWeight: 500, overflowWrap: 'anywhere', minWidth: 0 }}>
              {anchor}
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
            <CommentAuthor name={t.authorName} kind={t.authorKind} variant="caption" /> · {formatCommentTime(t.createdAt)}
          </Typography>
        </Box>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            overflowWrap: 'anywhere', whiteSpace: 'pre-line', fontStyle: t.deleted ? 'italic' : 'normal',
          }}
        >
          {t.deleted ? 'Comment deleted' : t.body}
        </Typography>
        {t.replies.length > 0 && (
          <Typography variant="caption" color="text.secondary">
            {t.replies.length} {t.replies.length === 1 ? 'reply' : 'replies'}
          </Typography>
        )}
      </Box>
      <Button
        size="small"
        variant="outlined"
        onClick={onShow}
        aria-label={`Show in context: ${t.authorName}'s comment on ${where}`}
        sx={{ flexShrink: 0, textTransform: 'none' }}
      >
        Show in context
      </Button>
    </Box>
  );
}
