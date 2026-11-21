'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import type { CommentCardKey } from '@perfana/shared/constants/comment-cards';
import type { CommentView } from '@/lib/test-run-comments';
import { formatCommentTime } from '@/lib/test-run-comments';
import { fetchStory, markStorySeen, storyHref, type RunStory, type RunStoryStep } from '@/lib/test-run-stories';
import { expansionKeyOf, useComments } from '../comments/CommentsContext';
import { CommentTagChip } from '../comments/CommentTagChip';
import { firstLine, isTypingTarget, stepWhere, tagOf } from './story-format';
import { AI_DRAFT_LABEL, StoryAuthorLine } from './StoryAuthorLine';
import CommentAuthor from '../comments/CommentAuthor';

/** How long a revealed card gets to appear before the bar says it is not on this run. */
const CARD_PRESENCE_TIMEOUT_MS = 1500;

/** `?story=&step=` → which screen: the intro (no step), a step (1..N) or the conclusion (> N). */
export function readerScreen(stepParam: string | null, stepCount: number): { kind: 'intro' } | { kind: 'step'; index: number } | { kind: 'end' } {
  if (stepParam === null || stepParam === '') return { kind: 'intro' };
  const n = Number.parseInt(stepParam, 10);
  if (!Number.isFinite(n) || n < 1) return { kind: 'intro' };
  if (n > stepCount) return { kind: 'end' };
  return { kind: 'step', index: n - 1 };
}

/**
 * The story reader (design: "Reader"). `?story=<id>&step=<n>`, 1-based; no step is the intro,
 * past the last step the conclusion. A step reveals its card, focuses its item and replays its view
 * — never opening the drawer — while a bar fixed to the bottom of the viewport carries the comment.
 *
 * View preservation: the first time a step replays a view on a card, that card's current view is
 * captured (`captureView`); the per-replay "Showing the comment's view · Undo" toasts are
 * suppressed (`silent`), and leaving the story (Exit, Esc, or the URL losing `story`) puts every
 * captured card back. Opening it marks the investigation itself read (`PUT /stories/:id/seen`), never
 * the comments in it: those stay unread until their card's drawer is open.
 */
export default function StoryReader() {
  const ctx = useComments();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const storyId = params.get('story');
  const stepParam = params.get('step');
  const [story, setStory] = useState<RunStory | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [barHeight, setBarHeight] = useState(0);
  // The page keeps room for the bar (an in-flow spacer of its height), so it never covers the
  // last thing on the page; the bar grows when "more" expands it.
  const observer = useRef<ResizeObserver | null>(null);
  const barRef = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) {
      setBarHeight(0);
      return;
    }
    const measure = () => setBarHeight(el.getBoundingClientRect().height);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    observer.current = new ResizeObserver(measure);
    observer.current.observe(el);
  }, []);

  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const snapshots = useRef(new Map<CommentCardKey, CommentView | null>());

  const go = useCallback(
    (step: number | null | undefined) => {
      const base = new URLSearchParams(params.toString());
      const href = step === null ? storyHref(base, null) : storyHref(base, storyId, step);
      router.replace(`${pathname}${href}`, { scroll: false });
    },
    [params, router, pathname, storyId],
  );
  const exit = useCallback(() => go(null), [go]);

  // Load, and refetch on any change to this story (body-free socket event) or to a comment in it.
  const storyEventSeq = ctx?.storyEvent?.storyId === storyId ? ctx?.storyEvent?.seq : 0;
  const lastEvent = ctx?.lastEvent;
  const stepCommentIds = useMemo(() => new Set(story?.steps.map((s) => s.comment.id) ?? []), [story]);
  const commentSeq = lastEvent && stepCommentIds.has(lastEvent.comment.id) ? lastEvent.seq : 0;
  useEffect(() => {
    if (!storyId) {
      setStory(null);
      setLoadError(null);
      return;
    }
    let live = true;
    fetchStory(storyId)
      .then((s) => {
        if (!live) return;
        setStory(s);
        setLoadError(null);
      })
      .catch((e: unknown) => {
        if (!live) return;
        const status = (e as { status?: number })?.status;
        setLoadError(status === 404 ? 'This story is not available: it was deleted, unpublished, or is not yours to read.' : e instanceof Error ? e.message : 'Loading the story failed');
      });
    return () => {
      live = false;
    };
  }, [storyId, storyEventSeq, commentSeq]);

  // Opening an investigation marks it read for the caller (PR7), once per story per visit and only
  // when the API says it is unread, so a refetch does not write again. This is the one place it is
  // marked read; the Comments dialog never does.
  const markedSeen = useRef<string | null>(null);
  useEffect(() => {
    if (!story || story.id !== storyId || !story.unread || markedSeen.current === story.id) return;
    markedSeen.current = story.id;
    markStorySeen(story.id)
      .then(() => ctxRef.current?.noteStoryRead?.())
      .catch(() => {
        markedSeen.current = null;
      });
  }, [story, storyId]);

  // Leaving the story (or switching to another one) puts back every card it replaced a view on.
  // One card at a time: the page keeps a single view request, which each card consumes on its own
  // commit, so two requests in one tick would leave only the last.
  useEffect(() => {
    if (!storyId) return;
    const saved = snapshots.current;
    return () => {
      const entries = [...saved.entries()];
      saved.clear();
      ctxRef.current?.setActiveThreadId(null);
      entries.forEach(([card, view], i) => setTimeout(() => ctxRef.current?.applyView(card, view), i * 60));
    };
  }, [storyId]);

  const screen = story ? readerScreen(stepParam, story.steps.length) : null;
  const step: RunStoryStep | null = story && screen?.kind === 'step' ? story.steps[screen.index] ?? null : null;
  const stepCommentId = step?.comment.id;
  const stepIndex = screen?.kind === 'step' ? screen.index : -1;

  // What a step does: reveal the card, focus the item, replay the view. Never the drawer. Keyed on
  // the step's comment, so a refetch of the same story does not navigate again.
  useEffect(() => {
    setExpanded(false);
    setUnavailable(false);
    const c = ctxRef.current;
    if (!c || !step) return;
    const comment = step.comment;
    if (comment.deleted) return; // a deleted step keeps its place in the walk and goes nowhere
    const key = expansionKeyOf(comment.cardKey);
    if (!key) {
      setUnavailable(true);
      return;
    }
    if (comment.chartContext && !snapshots.current.has(comment.cardKey)) {
      snapshots.current.set(comment.cardKey, c.captureView(comment.cardKey, comment.itemKey));
    }
    c.reveal(key);
    if (comment.itemKey) c.focusItem(comment.cardKey, comment.itemKey);
    if (comment.chartContext) c.restoreView(comment, { silent: true });
    c.setActiveThreadId(comment.markerSeq != null ? comment.id : null);
    const t = setTimeout(() => {
      if (!document.querySelector(`[data-testid="comment-card-${key}"]`)) setUnavailable(true);
    }, CARD_PRESENCE_TIMEOUT_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the step, not on refetched objects
  }, [storyId, stepIndex, stepCommentId]);

  const count = story?.steps.length ?? 0;
  const prev = useCallback(() => {
    if (!screen) return;
    if (screen.kind === 'end') go(count);
    else if (screen.kind === 'step') go(screen.index === 0 ? undefined : screen.index);
  }, [screen, count, go]);
  const next = useCallback(() => {
    if (!screen) return;
    if (screen.kind === 'intro') go(1);
    else if (screen.kind === 'step') go(screen.index + 2);
  }, [screen, go]);

  // ← / → and Esc, unless a text field has focus.
  useEffect(() => {
    if (!storyId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || isTypingTarget(e.target)) return;
      if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'Escape') exit();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [storyId, prev, next, exit]);


  if (!storyId || !ctx) return null;

  if (loadError || !story) {
    return loadError ? (
      <StoryBarFrame barRef={barRef} barHeight={barHeight}>
        <Typography variant="body2" sx={{ flex: 1 }} role="status">{loadError}</Typography>
        <Button size="small" onClick={exit}>Exit</Button>
      </StoryBarFrame>
    ) : null;
  }

  const intro = screen?.kind === 'intro';
  const end = screen?.kind === 'end';
  return (
    <>
      <Dialog open={intro} onClose={exit} fullWidth maxWidth="sm" aria-labelledby="story-intro-title">
        <DialogTitle id="story-intro-title">{story.title}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {story.authorKind === 'agent' && story.status === 'published' ? <StoryAuthorLine story={story} /> : <>A story by <StoryAuthorLine story={story} /></>}
            {story.status === 'draft'
              ? story.authorKind === 'agent'
                ? ` · ${AI_DRAFT_LABEL}, visible to everyone who can see this run`
                : ' · draft, visible only to you'
              : story.publishedAt
                ? ` · published ${formatCommentTime(story.publishedAt)}`
                : ''}
            {` · ${count} ${count === 1 ? 'step' : 'steps'}`}
          </Typography>
          <StepList story={story} onPick={(i) => go(i + 1)} />
        </DialogContent>
        <DialogActions>
          <Button onClick={exit}>Close</Button>
          <Button variant="contained" onClick={() => go(1)} disabled={count === 0} autoFocus>
            Start
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={end} onClose={exit} fullWidth maxWidth="sm" aria-labelledby="story-end-title">
        <DialogTitle id="story-end-title">{story.title}: conclusion</DialogTitle>
        <DialogContent>
          {story.summary ? (
            <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', mb: 2 }}>{story.summary}</Typography>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>The author wrote no conclusion.</Typography>
          )}
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Back to a step</Typography>
          <StepList story={story} onPick={(i) => go(i + 1)} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => go(count)} disabled={count === 0}>‹ Last step</Button>
          <Button variant="contained" onClick={exit}>Exit story</Button>
        </DialogActions>
      </Dialog>
      {step && screen?.kind === 'step' && (
        <StoryBarFrame barRef={barRef} barHeight={barHeight}>
          <StepBar
            story={story}
            step={step}
            index={screen.index}
            expanded={expanded}
            unavailable={unavailable}
            onExpand={() => setExpanded((v) => !v)}
            onPrev={prev}
            onNext={next}
            onExit={exit}
            onOpenThread={() => {
              const key = expansionKeyOf(step.comment.cardKey);
              if (!key) return;
              ctx.reveal(key);
              ctx.openDrawer(step.comment.cardKey, step.comment.id);
            }}
          />
        </StoryBarFrame>
      )}
    </>
  );
}

/** The bar's frame plus an in-flow spacer of the bar's height, so the page can scroll past it. */
function StoryBarFrame({ barRef, barHeight, children }: { barRef: (el: HTMLDivElement | null) => void; barHeight: number; children: React.ReactNode }) {
  return (
    <>
      <Box aria-hidden data-testid="story-bar-spacer" sx={{ height: barHeight ? barHeight + 24 : 0 }} />
      <Paper
        ref={barRef}
        elevation={8}
        role="region"
        aria-label="Story"
        data-testid="story-bar"
        sx={{
          position: 'fixed',
          left: '50%',
          transform: 'translateX(-50%)',
          bottom: 16,
          width: 'min(1040px, calc(100vw - 32px))',
          maxHeight: '45vh',
          overflowY: 'auto',
          zIndex: (t) => t.zIndex.snackbar - 1,
          borderRadius: 3,
          border: 1,
          borderColor: 'divider',
          p: 1.5,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 1.5,
          flexWrap: 'wrap',
        }}
      >
        {children}
      </Paper>
    </>
  );
}

function StepBar({
  story,
  step,
  index,
  expanded,
  unavailable,
  onExpand,
  onPrev,
  onNext,
  onExit,
  onOpenThread,
}: {
  story: RunStory;
  step: RunStoryStep;
  index: number;
  expanded: boolean;
  unavailable: boolean;
  onExpand: () => void;
  onPrev: () => void;
  onNext: () => void;
  onExit: () => void;
  onOpenThread: () => void;
}) {
  const c = step.comment;
  const tag = tagOf(c);
  const count = story.steps.length;
  const long = !c.deleted && (c.body?.length ?? 0) > 180;
  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
        <Button size="small" onClick={onPrev} aria-label={index === 0 ? 'Back to the introduction' : 'Previous step'}>‹ Prev</Button>
        <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }} aria-live="polite">
          Step {index + 1} of {count}
        </Typography>
      </Box>
      <Box sx={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', minWidth: 0 }}>
          {tag && <CommentTagChip tag={tag} />}
          <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{stepWhere(c)}</Typography>
          {unavailable && !c.deleted && (
            <Typography variant="caption" color="text.secondary" data-testid="story-card-unavailable">· card not available on this run</Typography>
          )}
        </Box>
        {c.deleted ? (
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>Comment deleted</Typography>
        ) : (
          <Typography
            variant="body2"
            data-testid="story-bar-body"
            sx={{
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              ...(expanded ? {} : { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }),
            }}
          >
            {c.body}
          </Typography>
        )}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          {!c.deleted && (
            <Typography variant="caption" color="text.secondary">
              <CommentAuthor name={c.authorName} kind={c.authorKind} variant="inherit" />, {formatCommentTime(c.createdAt)}
              {c.editedAt ? ' (edited)' : ''}
              {c.replyCount > 0 ? ` · ${c.replyCount} ${c.replyCount === 1 ? 'reply' : 'replies'}` : ''}
            </Typography>
          )}
          {long && (
            <Link component="button" type="button" variant="caption" onClick={onExpand}>
              {expanded ? 'less' : 'more'}
            </Link>
          )}
          {!c.deleted && !unavailable && (
            <Link component="button" type="button" variant="caption" onClick={onOpenThread}>Open thread</Link>
          )}
        </Box>
        {step.note && (
          <Typography variant="body2" color="text.secondary" sx={{ borderLeft: 2, borderColor: 'divider', pl: 1, overflowWrap: 'anywhere' }} data-testid="story-step-note">
            {step.note}
          </Typography>
        )}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0, ml: 'auto' }}>
        <Button size="small" variant="contained" onClick={onNext}>{index + 1 === count ? 'Conclusion ›' : 'Next ›'}</Button>
        <IconButton size="small" onClick={onExit} aria-label="Exit story">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>
    </>
  );
}

/** The table of contents: tag chip, card › item and the comment's first line, per step. */
function StepList({ story, onPick }: { story: RunStory; onPick: (index: number) => void }) {
  return (
    <Box component="ol" sx={{ listStyle: 'none', p: 0, m: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      {story.steps.map((s, i) => {
        const tag = tagOf(s.comment);
        return (
          <Box component="li" key={s.comment.id}>
            <Button
              onClick={() => onPick(i)}
              sx={{ textTransform: 'none', justifyContent: 'flex-start', textAlign: 'left', width: '100%', gap: 1, color: 'text.primary', alignItems: 'flex-start' }}
            >
              <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 20, fontVariantNumeric: 'tabular-nums' }}>{i + 1}</Typography>
              <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  {tag && <CommentTagChip tag={tag} />}
                  <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{stepWhere(s.comment)}</Typography>
                </Box>
                <Typography variant="body2" color="text.secondary" noWrap sx={{ fontStyle: s.comment.deleted ? 'italic' : 'normal' }}>
                  {firstLine(s.comment)}
                </Typography>
              </Box>
            </Button>
          </Box>
        );
      })}
    </Box>
  );
}
