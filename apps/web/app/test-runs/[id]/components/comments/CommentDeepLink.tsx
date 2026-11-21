'use client';

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useComments } from './CommentsContext';

/**
 * `?card=<comment card key>&comment=<id>`: reveal the card, open its drawer and highlight the
 * thread (design premise 6). Card links without `comment` are left to the page's own effect.
 */
export default function CommentDeepLink() {
  const params = useSearchParams();
  const ctx = useComments();
  const done = useRef<string | null>(null);
  const card = params.get('card');
  const comment = params.get('comment');
  const jumpTo = params.get('comments'); // 'next' (first unread) or 'first' (first with comments)
  const jumped = useRef(false);
  // From the test-run list's comment badge: jump once the counts have arrived.
  useEffect(() => {
    if (!ctx || !jumpTo || jumped.current) return;
    if (jumpTo === 'next' && ctx.nextUnreadCard) {
      jumped.current = true;
      ctx.jumpToNextUnread();
    } else if (jumpTo === 'first' && Object.values(ctx.counts).some((c) => (c?.total ?? 0) > 0)) {
      jumped.current = true;
      ctx.jumpToFirstCommented();
    }
  }, [ctx, jumpTo]);
  useEffect(() => {
    if (!ctx || !card || !comment || done.current === comment) return;
    if (ctx.showComment(card, comment)) done.current = comment;
  }, [ctx, card, comment]);
  return null;
}
