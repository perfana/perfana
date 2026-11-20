'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  COMMENT_CARD_BY_EXPANSION_KEY,
  type CommentCardKey,
} from '@perfana/shared/constants/comment-cards';
import { socketManager } from '@/lib/socket';
import { fetchCommentCounts, fetchCommentItemCounts, markCommentsSeen, type CardCommentCounts, type CommentItemCounts, type RunComment } from '@/lib/test-run-comments';
import { TAB_CARDS } from '../../hooks/useExpansionState';
import type { ExpansionState } from '../../types';

export type CommentEvent =
  | { type: 'comment:created' | 'comment:updated'; comment: RunComment; seq: number }
  | { type: 'comment:deleted'; comment: RunComment & { hardDeleted?: boolean }; seq: number };

/** Every card in page order (Results, then RCA, then Reporting), for the header's next-unread jump. */
const PAGE_ORDER: (keyof ExpansionState)[] = Object.values(TAB_CARDS).flat();

export const CARD_LABELS: Record<CommentCardKey, string> = {
  details: 'Test run details',
  config: 'Configuration',
  dashboards: 'Dashboards',
  anomaly: 'Anomaly detection',
  performance: 'Performance analysis',
  slo: 'Service level objectives',
  'deep-links': 'Deep links',
  events: 'Events',
  dynatrace: 'Dynatrace',
  'distributed-tracing': 'Distributed tracing',
  pyroscope: 'Pyroscope',
  splunk: 'Splunk',
  awr: 'AWR report',
  report: 'Reports',
  trends: 'Trends',
  compare: 'Compare',
  graphs: 'Graphs',
};

export function cardKeyOf(expansionKey: keyof ExpansionState): CommentCardKey {
  return COMMENT_CARD_BY_EXPANSION_KEY[expansionKey];
}

export function expansionKeyOf(card: string): keyof ExpansionState | undefined {
  return (Object.keys(COMMENT_CARD_BY_EXPANSION_KEY) as (keyof ExpansionState)[]).find(
    (k) => COMMENT_CARD_BY_EXPANSION_KEY[k] === card,
  );
}

interface CommentsContextValue {
  runId: string;
  /** Per card: total comments and unread ones. */
  counts: CardCommentCounts;
  unread: Partial<Record<CommentCardKey, number>>;
  totalUnread: number;
  /** The card whose drawer is open, if any. */
  openCard: CommentCardKey | null;
  /** A comment to scroll to and highlight once (deep link). */
  focusCommentId: string | null;
  lastEvent: CommentEvent | null;
  live: boolean;
  openDrawer: (card: CommentCardKey, focusCommentId?: string) => void;
  closeDrawer: () => void;
  /** Reveal and open the first card in page order that has unread comments. */
  jumpToNextUnread: () => void;
  nextUnreadCard: CommentCardKey | null;
  /** Reveal and open the first card in page order that has any comments. */
  jumpToFirstCommented: () => void;
  /** Switch to a card's tab, expand it and scroll to it. */
  reveal: (expansionKey: keyof ExpansionState) => void;
  /** The item the drawer's new-comment box is anchored to, if the user started from a row. */
  composeAnchor: { card: CommentCardKey; itemKey: string; itemLabel: string } | null;
  /** Open the card's drawer with the new-comment box anchored to one row. */
  commentOnItem: (card: CommentCardKey, itemKey: string, itemLabel: string) => void;
  clearComposeAnchor: () => void;
  /** The last "show me this row" request; cards answer it through useCommentItemFocus. */
  itemFocus: { card: CommentCardKey; itemKey: string; seq: number } | null;
  focusItem: (card: CommentCardKey, itemKey: string) => void;
}

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
  reveal,
  children,
}: {
  /** The run's uuid (`test_runs.id`), which keys the per-run socket room. */
  runId: string;
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
    return () => {
      offState();
      offs.forEach((off) => off());
      socketManager.emit('unsubscribe:test-run', { testRunId: runId });
    };
  }, [runId, refreshUnread]);

  const openDrawer = useCallback(
    (card: CommentCardKey, focus?: string) => {
      setOpenCard(card);
      setFocusCommentId(focus ?? null);
      // The drawer marks the card seen on the server once it has read the previous mark.
      setCounts((prev) => (prev[card] ? { ...prev, [card]: { ...prev[card]!, unread: 0 } } : prev));
    },
    [],
  );
  const closeDrawer = useCallback(() => {
    setOpenCard(null);
    setFocusCommentId(null);
    setComposeAnchor(null);
  }, []);
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

  const nextUnreadCard = useMemo(
    () => PAGE_ORDER.map(cardKeyOf).find((c) => (unread[c] ?? 0) > 0) ?? null,
    [unread],
  );
  const jumpToNextUnread = useCallback(() => {
    if (!nextUnreadCard) return;
    const key = expansionKeyOf(nextUnreadCard);
    if (key) reveal(key);
    openDrawer(nextUnreadCard);
  }, [nextUnreadCard, reveal, openDrawer]);

  const jumpToFirstCommented = useCallback(() => {
    const card = PAGE_ORDER.map(cardKeyOf).find((c) => (counts[c]?.total ?? 0) > 0);
    const key = card && expansionKeyOf(card);
    if (!card || !key) return;
    reveal(key);
    openDrawer(card);
  }, [counts, reveal, openDrawer]);

  const totalUnread = Object.values(unread).reduce<number>((a, b) => a + (b ?? 0), 0);

  const value = useMemo(
    () => ({ runId, counts, unread, totalUnread, openCard, focusCommentId, lastEvent, live, openDrawer, closeDrawer, jumpToNextUnread, nextUnreadCard, jumpToFirstCommented, reveal, composeAnchor, commentOnItem, clearComposeAnchor, itemFocus, focusItem }),
    [runId, counts, unread, totalUnread, openCard, focusCommentId, lastEvent, live, openDrawer, closeDrawer, jumpToNextUnread, nextUnreadCard, jumpToFirstCommented, reveal, composeAnchor, commentOnItem, clearComposeAnchor, itemFocus, focusItem],
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
