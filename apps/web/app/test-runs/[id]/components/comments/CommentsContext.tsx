'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  COMMENT_CARD_BY_EXPANSION_KEY,
  COMMENT_CARD_LABELS,
  type CommentCardKey,
} from '@perfana/shared/constants/comment-cards';
import { socketManager } from '@/lib/socket';
import { fetchCommentCounts, fetchCommentItemCounts, fetchCommentThreads, markCommentsSeen, type CardCommentCounts, type CommentItemCounts, type CommentView, type MarkerChartContext, type RunComment, type RunCommentThread } from '@/lib/test-run-comments';
import { TAB_CARDS } from '../../hooks/useExpansionState';
import type { ExpansionState } from '../../types';

export type CommentEvent =
  | { type: 'comment:created' | 'comment:updated'; comment: RunComment; seq: number }
  | { type: 'comment:deleted'; comment: RunComment & { hardDeleted?: boolean }; seq: number };

/**
 * An expansion key whose card takes comments. Every card on the page does (the comments test
 * asserts each expansion key has a stored card key); the run-wide list lives in the header's
 * Comments dialog, not in a card.
 */
export type CommentableExpansionKey = keyof typeof COMMENT_CARD_BY_EXPANSION_KEY;

export const CARD_LABELS: Readonly<Record<CommentCardKey, string>> = COMMENT_CARD_LABELS;

export function cardKeyOf(expansionKey: CommentableExpansionKey): CommentCardKey;
export function cardKeyOf(expansionKey: keyof ExpansionState): CommentCardKey | undefined;
export function cardKeyOf(expansionKey: keyof ExpansionState): CommentCardKey | undefined {
  return (COMMENT_CARD_BY_EXPANSION_KEY as Partial<Record<keyof ExpansionState, CommentCardKey>>)[expansionKey];
}

/**
 * Every commentable card in page order (Results, then RCA, then Reporting), for the Comments
 * dialog's next-unread jump. A key without a comment card key would be skipped, not crash.
 */
export const PAGE_ORDER: CommentCardKey[] = Object.values(TAB_CARDS)
  .flat()
  .map((k) => cardKeyOf(k))
  .filter((c): c is CommentCardKey => c !== undefined);

export function expansionKeyOf(card: string): CommentableExpansionKey | undefined {
  return (Object.keys(COMMENT_CARD_BY_EXPANSION_KEY) as CommentableExpansionKey[]).find(
    (k) => COMMENT_CARD_BY_EXPANSION_KEY[k] === card,
  );
}

/**
 * A marker being placed on the Graphs card (design DR5/DR12). The Graphs card owns the chart,
 * so it hands over the buckets the draft may snap to and how to read the chart's view at
 * post time; the drawer owns the text.
 */
export interface MarkerDraft {
  /** The bucket the pending pin sits on. */
  time: string;
  /** Every bucket on the chart, in time order, for the drawer's step buttons. */
  steps: string[];
  capture: () => MarkerChartContext;
}

interface CommentsContextValue {
  runId: string;
  /** The run's start, for "+mm:ss" marker times. */
  runStart?: string | null;
  /** Per card: total comments and unread ones. */
  counts: CardCommentCounts;
  unread: Partial<Record<CommentCardKey, number>>;
  totalUnread: number;
  /** Of `totalUnread`, how many an AI agent wrote. */
  totalUnreadAgent: number;
  /** The card whose drawer is open, if any. */
  openCard: CommentCardKey | null;
  /** A comment to scroll to and highlight once (deep link). */
  focusCommentId: string | null;
  lastEvent: CommentEvent | null;
  live: boolean;
  openDrawer: (card: CommentCardKey, focusCommentId?: string, replay?: boolean) => void;
  closeDrawer: () => void;
  /** Reveal and open the first card in page order that has unread comments. */
  jumpToNextUnread: () => void;
  nextUnreadCard: CommentCardKey | null;
  /** Reveal and open the first card in page order that has any comments. */
  jumpToFirstCommented: () => void;
  /** Switch to a card's tab, expand it and scroll to it. */
  reveal: (expansionKey: keyof ExpansionState) => void;
  /**
   * Show one comment where it was written: reveal its card, open the drawer on its thread and
   * replay its view (the `?card=&comment=` deep link). False when `card` is not a comment card.
   */
  showComment: (card: string, commentId: string) => boolean;
  /** The item the drawer's new-comment box is anchored to, if the user started from a row. */
  composeAnchor: { card: CommentCardKey; itemKey: string; itemLabel: string } | null;
  /** Open the card's drawer with the new-comment box anchored to one row. */
  commentOnItem: (card: CommentCardKey, itemKey: string, itemLabel: string) => void;
  clearComposeAnchor: () => void;
  /** The last "show me this row" request; cards answer it through useCommentItemFocus. */
  itemFocus: { card: CommentCardKey; itemKey: string; seq: number } | null;
  focusItem: (card: CommentCardKey, itemKey: string) => void;
  /** True when the open drawer was opened by a deep link that should replay a marker's view. */
  focusReplay: boolean;
  markerDraft: MarkerDraft | null;
  startMarker: (draft: MarkerDraft) => void;
  moveMarker: (time: string) => void;
  cancelMarker: () => void;
  /** The thread expanded in the drawer, so the chart can show its pin as selected. */
  activeThreadId: string | null;
  setActiveThreadId: (id: string | null) => void;
  /**
   * The latest "show this comment's view" request; the card it names consumes each key once.
   * `silent`: apply it without the card's "Showing the comment's view · Undo" toast (a story walk
   * owns the one undo for the whole walk).
   */
  viewRequest: ViewRequest | null;
  restoreView: (comment: RunComment, opts?: { silent?: boolean }) => void;
  /**
   * Put a card back to a view captured earlier (`captureView`), without revealing the card and
   * without a toast. `null` clears a chart card back to no series (what an empty chart captures).
   * Used by the story reader's Exit.
   */
  applyView: (card: CommentCardKey, view: CommentView | null) => void;
  /** The last `story:changed` for this run; consumers refetch through the access-checked GET. */
  storyEvent: { storyId: string; seq: number } | null;
  /**
   * Record a story change this client made itself (Add to investigation), so the lists refetch
   * even when the socket is down; the `story:changed` echo then refetches once more, harmlessly.
   */
  noteStoryChanged: (storyId: string) => void;
  /** Bumped when the reader marked an investigation read, so its unread badges refetch. */
  storyReadSeq: number;
  noteStoryRead: () => void;
  /**
   * A card (Graphs, Trends, Compare, Configuration) registers how to read its current view;
   * returns the unregister. `itemKey` is the item the new comment is anchored to, for a card
   * whose view is per item (Configuration).
   */
  registerViewCapture: (card: CommentCardKey, capture: ViewCapture) => () => void;
  /** The card's current view, for a root comment to record; null when the card records none. */
  captureView: (card: CommentCardKey, itemKey?: string | null) => CommentView | null;
}

export interface ViewRequest {
  card: CommentCardKey;
  key: string;
  comment: RunComment;
  silent?: boolean;
}

/**
 * The view that clears a chart card back to no series. Graphs and Compare apply an empty series
 * list as such; Trends recognises it (no aggregation) and clears its series only.
 */
export function emptyViewFor(card: CommentCardKey): CommentView | null {
  if (card === 'graphs') return { kind: 'graphs', series: [] };
  if (card === 'compare') return { kind: 'compare', series: [] };
  if (card === 'trends') return { kind: 'trends', series: [], timeRange: '', evaluateType: '' };
  return null;
}

/** Reads a card's view for a new root comment; `itemKey` is the comment's anchor, if any. */
export type ViewCapture = (itemKey?: string | null) => CommentView | null;

const CommentsContext = createContext<CommentsContextValue | null>(null);

export function useComments(): CommentsContextValue | null {
  return useContext(CommentsContext);
}

/**
 * Page-level comments state for one run (design: docs/designs/test-run-comments.md).
 * Must wrap the tabs from OUTSIDE their memoised TabBody, or a hidden tab's badges freeze.
 *
 * Seen = the card's drawer is open: opening it marks the card seen, and so does any comment
 * event that arrives for that card while it stays open.
 */
export function CommentsProvider({
  runId,
  runStart,
  reveal,
  children,
}: {
  /** The run's uuid (`test_runs.id`), which keys the per-run socket room. */
  runId: string;
  runStart?: string | null;
  /** Switch to the card's tab, expand it and scroll to it. */
  reveal: (expansionKey: keyof ExpansionState) => void;
  children: React.ReactNode;
}) {
  const [counts, setCounts] = useState<CardCommentCounts>({});
  const unread = useMemo(
    () => Object.fromEntries(Object.entries(counts).map(([k, c]) => [k, c?.unread ?? 0])) as Partial<Record<CommentCardKey, number>>,
    [counts],
  );
  const [openCard, setOpenCard] = useState<CommentCardKey | null>(null);
  const [focusCommentId, setFocusCommentId] = useState<string | null>(null);
  const [lastEvent, setLastEvent] = useState<CommentEvent | null>(null);
  const [live, setLive] = useState(socketManager.isConnected());
  const [composeAnchor, setComposeAnchor] = useState<CommentsContextValue['composeAnchor']>(null);
  const [itemFocus, setItemFocus] = useState<CommentsContextValue['itemFocus']>(null);
  const [focusReplay, setFocusReplay] = useState(false);
  const [markerDraft, setMarkerDraft] = useState<MarkerDraft | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [viewRequest, setViewRequest] = useState<CommentsContextValue['viewRequest']>(null);
  const [storyEvent, setStoryEvent] = useState<CommentsContextValue['storyEvent']>(null);
  const [storyReadSeq, setStoryReadSeq] = useState(0);
  const captures = useRef(new Map<CommentCardKey, ViewCapture>());
  const openCardRef = useRef(openCard);
  openCardRef.current = openCard;
  const seqRef = useRef(0);

  const refreshUnread = useCallback(() => {
    fetchCommentCounts(runId).then(setCounts).catch(() => undefined);
  }, [runId]);

  useEffect(refreshUnread, [refreshUnread]);

  // Join the per-run room (it alone carries comment text) and re-join after every reconnect.
  useEffect(() => {
    const join = () => socketManager.emit('subscribe:test-run', { testRunId: runId });
    join();
    const offState = socketManager.onConnectionStateChange((state) => {
      setLive(state === 'connected');
      if (state === 'connected') {
        join();
        refreshUnread(); // events missed while disconnected
      }
    });
    const handler = (type: CommentEvent['type']) => (comment: RunComment) => {
      if (comment.testRunId !== runId) return;
      setLastEvent({ type, comment, seq: ++seqRef.current } as CommentEvent);
      const seen = openCardRef.current === comment.cardKey ? markCommentsSeen(runId, comment.cardKey) : Promise.resolve();
      seen.catch(() => undefined).finally(refreshUnread);
    };
    const offs = (['comment:created', 'comment:updated', 'comment:deleted'] as const).map((t) =>
      socketManager.on<RunComment>(t, handler(t)),
    );
    // Body-free on purpose (drafts are private): only ids, the UI refetches what it shows.
    const offStory = socketManager.on<{ testRunId: string; storyId: string }>('story:changed', (e) => {
      if (e?.testRunId !== runId || typeof e.storyId !== 'string') return;
      setStoryEvent({ storyId: e.storyId, seq: ++seqRef.current });
    });
    return () => {
      offState();
      offs.forEach((off) => off());
      offStory();
      socketManager.emit('unsubscribe:test-run', { testRunId: runId });
    };
  }, [runId, refreshUnread]);

  const openDrawer = useCallback(
    (card: CommentCardKey, focus?: string, replay = false) => {
      setOpenCard(card);
      setFocusCommentId(focus ?? null);
      setFocusReplay(replay);
      if (card !== 'graphs') setMarkerDraft(null);
      // The drawer marks the card seen on the server once it has read the previous mark.
      setCounts((prev) => (prev[card] ? { ...prev, [card]: { ...prev[card]!, unread: 0, unreadAgent: 0 } } : prev));
    },
    [],
  );
  const closeDrawer = useCallback(() => {
    setOpenCard(null);
    setFocusCommentId(null);
    setComposeAnchor(null);
    setMarkerDraft(null); // closing the drawer removes the pending pin (DR5)
    setActiveThreadId(null);
  }, []);
  const startMarker = useCallback(
    (draft: MarkerDraft) => {
      setComposeAnchor(null);
      setMarkerDraft(draft);
      setOpenCard('graphs');
      setFocusCommentId(null);
    },
    [],
  );
  const moveMarker = useCallback((time: string) => setMarkerDraft((d) => (d ? { ...d, time } : d)), []);
  const cancelMarker = useCallback(() => setMarkerDraft(null), []);
  const restoreView = useCallback(
    (comment: RunComment, opts?: { silent?: boolean }) => {
      if (!comment.chartContext) return;
      const key = expansionKeyOf(comment.cardKey);
      if (key) reveal(key);
      // A fresh key per request, so "Restore view" twice replays twice; the card skips seen keys.
      setViewRequest({ card: comment.cardKey, key: `comment:${comment.id}:${++seqRef.current}`, comment, ...(opts?.silent ? { silent: true } : {}) });
    },
    [reveal],
  );
  const applyView = useCallback((card: CommentCardKey, view: CommentView | null) => {
    const chartContext = view ?? emptyViewFor(card);
    if (!chartContext) return;
    const seq = ++seqRef.current;
    // A synthetic root: the cards' replay path reads only the card, the view and (Configuration) the anchor.
    const comment: RunComment = {
      id: `restore-${seq}`, testRunId: '', cardKey: card, parentId: null, itemKey: null, itemLabel: null, body: null,
      deleted: false, authorId: '', authorName: '', markerSeq: null, markerTime: null, chartContext, tag: null,
      createdAt: new Date(0).toISOString(), editedAt: null,
    };
    setViewRequest({ card, key: `restore:${card}:${seq}`, comment, silent: true });
  }, []);
  const noteStoryChanged = useCallback((storyId: string) => setStoryEvent({ storyId, seq: ++seqRef.current }), []);
  const noteStoryRead = useCallback(() => setStoryReadSeq((n) => n + 1), []);
  const registerViewCapture = useCallback((card: CommentCardKey, capture: ViewCapture) => {
    captures.current.set(card, capture);
    return () => {
      if (captures.current.get(card) === capture) captures.current.delete(card);
    };
  }, []);
  const captureView = useCallback(
    (card: CommentCardKey, itemKey?: string | null) => captures.current.get(card)?.(itemKey) ?? null,
    [],
  );
  const commentOnItem = useCallback(
    (card: CommentCardKey, itemKey: string, itemLabel: string) => {
      openDrawer(card);
      setComposeAnchor({ card, itemKey, itemLabel });
    },
    [openDrawer],
  );
  const clearComposeAnchor = useCallback(() => setComposeAnchor(null), []);
  const focusItem = useCallback(
    (card: CommentCardKey, itemKey: string) => {
      const key = expansionKeyOf(card);
      if (key) reveal(key);
      setItemFocus({ card, itemKey, seq: ++seqRef.current });
    },
    [reveal],
  );

  const showComment = useCallback(
    (card: string, commentId: string) => {
      const key = expansionKeyOf(card);
      if (!key) return false;
      reveal(key);
      openDrawer(cardKeyOf(key), commentId, true); // a view is replayed (premise 6)
      return true;
    },
    [reveal, openDrawer],
  );

  const nextUnreadCard = useMemo(
    () => PAGE_ORDER.find((c) => (unread[c] ?? 0) > 0) ?? null,
    [unread],
  );
  const jumpToNextUnread = useCallback(() => {
    if (!nextUnreadCard) return;
    const key = expansionKeyOf(nextUnreadCard);
    if (key) reveal(key);
    openDrawer(nextUnreadCard);
  }, [nextUnreadCard, reveal, openDrawer]);

  const jumpToFirstCommented = useCallback(() => {
    const card = PAGE_ORDER.find((c) => (counts[c]?.total ?? 0) > 0);
    const key = card && expansionKeyOf(card);
    if (!card || !key) return;
    reveal(key);
    openDrawer(card);
  }, [counts, reveal, openDrawer]);

  const totalUnread = Object.values(unread).reduce<number>((a, b) => a + (b ?? 0), 0);
  const totalUnreadAgent = Object.values(counts).reduce<number>((a, c) => a + (c?.unreadAgent ?? 0), 0);

  const value = useMemo(
    () => ({ runId, runStart, counts, unread, totalUnread, totalUnreadAgent, openCard, focusCommentId, lastEvent, live, openDrawer, closeDrawer, jumpToNextUnread, nextUnreadCard, jumpToFirstCommented, reveal, showComment, composeAnchor, commentOnItem, clearComposeAnchor, itemFocus, focusItem, focusReplay, markerDraft, startMarker, moveMarker, cancelMarker, activeThreadId, setActiveThreadId, viewRequest, restoreView, applyView, storyEvent, noteStoryChanged, storyReadSeq, noteStoryRead, registerViewCapture, captureView }),
    [runId, runStart, counts, unread, totalUnread, totalUnreadAgent, openCard, focusCommentId, lastEvent, live, openDrawer, closeDrawer, jumpToNextUnread, nextUnreadCard, jumpToFirstCommented, reveal, showComment, composeAnchor, commentOnItem, clearComposeAnchor, itemFocus, focusItem, focusReplay, markerDraft, startMarker, moveMarker, cancelMarker, activeThreadId, viewRequest, restoreView, applyView, storyEvent, noteStoryChanged, storyReadSeq, noteStoryRead, registerViewCapture, captureView],
  );
  return <CommentsContext.Provider value={value}>{children}</CommentsContext.Provider>;
}

/**
 * Per-item thread counts for one card, refreshed when a comment event touches that card.
 * Only fetched while `enabled` (the card is expanded), so collapsed cards cost nothing.
 */
export function useCommentItemCounts(card: CommentCardKey, enabled: boolean): CommentItemCounts {
  const ctx = useComments();
  const [counts, setCounts] = useState<CommentItemCounts>({});
  const runId = ctx?.runId;
  const evt = ctx?.lastEvent;
  const relevant = evt && evt.comment.cardKey === card ? evt.seq : 0;
  const drawerOpen = ctx?.openCard === card;
  useEffect(() => {
    if (!runId || !enabled) return;
    let live = true;
    fetchCommentItemCounts(runId, card).then((c) => live && setCounts(c)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [runId, card, enabled, relevant, drawerOpen]);
  return counts;
}

/**
 * The Graphs card's markers (roots with a number), deleted ones included so their pins stay
 * greyed (design delete rule). Fetched while `enabled`, refreshed on any Graphs comment event.
 */
export function useGraphMarkers(enabled: boolean): RunCommentThread[] {
  const ctx = useComments();
  const [markers, setMarkers] = useState<RunCommentThread[]>([]);
  const runId = ctx?.runId;
  const evt = ctx?.lastEvent;
  const relevant = evt && evt.comment.cardKey === 'graphs' ? evt.seq : 0;
  const drawerOpen = ctx?.openCard === 'graphs';
  useEffect(() => {
    if (!runId || !enabled) return;
    let live = true;
    fetchCommentThreads(runId, 'graphs')
      .then((r) => live && setMarkers(r.threads.filter((t) => t.markerSeq !== null && t.markerTime)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [runId, enabled, relevant, drawerOpen]);
  return markers;
}

/**
 * Lets a card answer "show me this row": `onFocus` must make the row visible (clear a filter,
 * switch tab or page, expand it) and return true once the row exists in this run. A card that
 * loads its rows on expand returns false until they arrive, so it is asked again every 200 ms
 * for up to 10 s. Then the hook scrolls to `[data-comment-item="<key>"]` and flashes it.
 */
export function useCommentItemFocus(card: CommentCardKey, onFocus: (itemKey: string) => boolean): void {
  const ctx = useComments();
  const focus = ctx?.itemFocus;
  const onFocusRef = useRef(onFocus);
  onFocusRef.current = onFocus;
  useEffect(() => {
    if (!focus || focus.card !== card) return;
    let cancelled = false;
    let attempts = 0;
    const scroll = (tries: number) => {
      if (cancelled) return;
      const el = document.querySelector<HTMLElement>(`[data-comment-item="${CSS.escape(focus.itemKey)}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // No stylesheet needed: a 2 s fade on the row itself.
        el.animate?.([{ backgroundColor: 'rgba(25, 118, 210, 0.22)' }, { backgroundColor: 'transparent' }], { duration: 2000 });
        keepInView(el);
      } else if (tries < 20) {
        setTimeout(() => scroll(tries + 1), 150);
      }
    };
    // A freshly expanded card keeps loading above the row (tiles, charts, the row's own detail),
    // which pushes it out of view after the scroll. Re-centre it while the layout settles, for
    // 2.5 s at most, and stop as soon as the user scrolls or types.
    const keepInView = (el: HTMLElement) => {
      let userMoved = false;
      const stop = () => {
        userMoved = true;
      };
      const events = ['wheel', 'touchmove', 'keydown', 'mousedown'] as const;
      events.forEach((e) => window.addEventListener(e, stop, { once: true, passive: true }));
      let checks = 0;
      const check = () => {
        if (cancelled || userMoved || !el.isConnected || checks++ >= 8) {
          events.forEach((e) => window.removeEventListener(e, stop));
          return;
        }
        const r = el.getBoundingClientRect();
        if (r.top < 0 || r.top > window.innerHeight - 40) el.scrollIntoView({ block: 'center' });
        setTimeout(check, 300);
      };
      setTimeout(check, 600);
    };
    const ask = () => {
      if (cancelled) return;
      if (onFocusRef.current(focus.itemKey)) setTimeout(() => scroll(0), 150);
      else if (attempts++ < 50) setTimeout(ask, 200);
    };
    ask();
    return () => {
      cancelled = true;
    };
  }, [focus, card]);
}
