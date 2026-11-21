'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import CircularProgress from '@mui/material/CircularProgress';
import FormControlLabel from '@mui/material/FormControlLabel';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { COMMENT_TAGS, type CommentCardKey, type CommentTag } from '@perfana/shared/constants/comment-cards';
import { fetchCommentThreads, type RunCommentThread } from '@/lib/test-run-comments';
import { CARD_LABELS, PAGE_ORDER, useComments } from '../CommentsContext';
import { CommentTagChip } from '../CommentTagChip';
import { CommentRow, tagOf } from './CommentRow';

const newestFirst = (a: RunCommentThread, b: RunCommentThread) => Date.parse(b.createdAt) - Date.parse(a.createdAt);

/**
 * Every root on the run, fetched while `enabled` (the dialog is open) and kept current from the
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
 * The All comments tab of the run's Comments dialog (design: docs/designs/test-run-analysis-stories.md,
 * "The comments card", moved into a header dialog): every root on the run, newest first, with
 * client-side filters. `onShow` is called for "Show in context"; the dialog closes itself there
 * first. Reading the list marks nothing seen.
 */
export function AllComments({ enabled, onShow }: { enabled: boolean; onShow: (thread: RunCommentThread) => void }) {
  const { threads, error } = useRunThreads(enabled);
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

  return (
    <Box>
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
                  onShow={() => onShow(t)}
                />
              ))}
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
