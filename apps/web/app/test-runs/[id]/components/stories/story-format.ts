import { isCommentTag, type CommentTag } from '@perfana/shared/constants/comment-cards';
import type { RunComment } from '@/lib/test-run-comments';
import { CARD_LABELS } from '../comments/CommentsContext';

/** "Configuration › heap.max", "Graphs › Marker 3" or just the card. */
export function stepWhere(c: Pick<RunComment, 'cardKey' | 'itemLabel' | 'markerSeq'>): string {
  const card = CARD_LABELS[c.cardKey] ?? c.cardKey;
  const item = c.itemLabel ?? (c.markerSeq != null ? `Marker ${c.markerSeq}` : null);
  return item ? `${card} › ${item}` : card;
}

/** The first line of a comment, or what stands in for a deleted one. */
export function firstLine(c: Pick<RunComment, 'body' | 'deleted'>): string {
  if (c.deleted || c.body === null) return 'Comment deleted';
  return c.body.split('\n').find((l) => l.trim())?.trim() ?? '';
}

export const tagOf = (c: { tag?: unknown }): CommentTag | null => (isCommentTag(c.tag) ? c.tag : null);

/**
 * True when a key press belongs to the element that has focus: a text field, a select or anything
 * contenteditable. The reader's ← / → / Esc must leave those alone.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== 'string') return false;
  const el = target as HTMLElement;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  return el.isContentEditable || el.getAttribute?.('contenteditable') === 'true' || Boolean(el.closest?.('[contenteditable="true"]'));
}
