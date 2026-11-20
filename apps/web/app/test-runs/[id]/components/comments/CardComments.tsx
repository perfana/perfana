'use client';

import React, { useEffect } from 'react';
import { Box, useMediaQuery } from '@mui/material';
import CommentCountBadge from './CommentCountBadge';
import type { ExpansionState } from '../../types';
import { CARD_LABELS, cardKeyOf, useComments } from './CommentsContext';
import CommentsPanel, { COMMENTS_PANEL_WIDTH } from './CommentsDrawer';

/**
 * One card's grid cell plus its comment badge (design D1/DR2). Replaces the page's per-card
 * `<Box sx={cardBoxStyle(...)}>`, so the badge is added in one place instead of in every card
 * header. Badge states: unread → red pill with the unread count; comments, all read → neutral
 * pill with the total, always visible, collapsed or not; no comments → outlined icon on hover or
 * keyboard focus only. Never a "0".
 *
 * The comments panel lives here too, attached to the expanded card: beside it at >= 1200px,
 * below it on narrower screens. Opening comments on a collapsed card expands the card first;
 * collapsing the card closes its panel.
 */
export default function CardComments({
  card,
  expanded,
  children,
}: {
  card: keyof ExpansionState;
  expanded: boolean;
  children: React.ReactNode;
}) {
  const comments = useComments();
  const key = cardKeyOf(card);
  const total = comments?.counts[key]?.total ?? 0;
  const unread = comments?.counts[key]?.unread ?? 0;
  const panelOpen = Boolean(comments && comments.openCard === key && expanded);
  const wide = useMediaQuery('(min-width:1200px)');
  const closeDrawer = comments?.closeDrawer;
  const openCard = comments?.openCard;

  // A collapsed card has no room for its panel.
  useEffect(() => {
    if (!expanded && openCard === key) closeDrawer?.();
  }, [expanded, openCard, key, closeDrawer]);

  // Charts inside the card that only listen to window resizes relayout to the narrower width.
  useEffect(() => {
    const t = setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
    return () => clearTimeout(t);
  }, [panelOpen]);

  return (
    <Box
      data-testid={`comment-card-${card}`}
      sx={{
        gridColumn: expanded ? '1 / -1' : 'auto',
        height: expanded ? 'auto' : '293px',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        // A card without comments shows its (empty) badge on hover or keyboard focus only; this
        // descendant rule outranks the wrapper's own opacity below.
        '&:hover .card-comments-badge-wrap, &:focus-within .card-comments-badge-wrap': { opacity: 1 },
      }}
    >
      {/* One tree shape whether or not the panel is open: moving `children` into a new wrapper
          remounts the card and drops its state (the Graphs card lost its whole chart). */}
      <Box
        sx={
          panelOpen
            ? { display: 'flex', flexDirection: wide ? 'row' : 'column', gap: 2, alignItems: wide ? 'flex-start' : 'stretch' }
            : { display: 'contents' }
        }
      >
        <Box sx={panelOpen ? { flex: 1, minWidth: 0 } : { display: 'contents' }}>{children}</Box>
        {panelOpen && (
          <Box
            sx={{
              width: wide ? COMMENTS_PANEL_WIDTH : '100%',
              flexShrink: 0,
              // Stays in view while the (often very tall) card scrolls past. The page scrolls in
              // main.content-area, whose 32px padding adds to `top`; 80px keeps the bottom on
              // screen. Grows with its threads up to that, so a short card is not stretched.
              position: wide ? 'sticky' : 'static',
              top: 16,
              minHeight: 360,
              maxHeight: wide ? 'calc(100vh - 80px)' : 600,
              border: 1,
              borderColor: 'divider',
              borderRadius: 3,
              bgcolor: 'background.paper',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <CommentsPanel />
          </Box>
        )}
      </Box>
      {comments && (
        // Outside the card's corner, in the 24px grid gap, so it never covers a card's own header
        // controls (expand chevron, settings). Always visible once the card has comments.
        <Box
          className="card-comments-badge-wrap"
          sx={{
            position: 'absolute', top: -12, right: -12, zIndex: 2, borderRadius: 12, boxShadow: 1,
            opacity: total > 0 || panelOpen ? 1 : 0,
            transition: 'opacity 120ms',
          }}
        >
          <CommentCountBadge
            total={total}
            unread={unread}
            subject={CARD_LABELS[key]}
            testId={`card-comments-${key}`}
            className="card-comments-badge"
            onClick={() => {
              if (!expanded) comments.reveal(card);
              comments.openDrawer(key);
            }}
          />
        </Box>
      )}
    </Box>
  );
}
