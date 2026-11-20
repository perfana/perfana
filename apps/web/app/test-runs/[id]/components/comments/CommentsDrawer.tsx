'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Divider,
  IconButton,
  Skeleton,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import { COMMENT_BODY_MAX_LENGTH, type CommentCardKey } from '@perfana/shared/constants/comment-cards';
import { useAuth } from '@/contexts/auth-context';
import {
  deleteComment,
  editComment,
  fetchCommentThreads,
  formatCommentTime,
  markCommentsSeen,
  postComment,
  type RunComment,
  type RunCommentThread,
} from '@/lib/test-run-comments';
import { CARD_LABELS, useComments } from './CommentsContext';

/** Cards whose single thread opens (and focuses its item) as soon as the comments open. */
const AUTO_OPEN_SINGLE_THREAD = new Set<CommentCardKey>(['distributed-tracing']);

export const COMMENTS_PANEL_WIDTH = 380;

const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

/** Latest activity in a thread: its newest reply, or the root. */
const lastActivity = (t: RunCommentThread) => t.replies.reduce((max, r) => (r.createdAt > max ? r.createdAt : max), t.createdAt);

function Composer({
  placeholder,
  submitLabel,
  initial = '',
  autoFocus,
  onSubmit,
  onCancel,
}: {
  placeholder: string;
  submitLabel: string;
  initial?: string;
  autoFocus?: boolean;
  onSubmit: (body: string) => Promise<void>;
  onCancel?: () => void;
}) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = text.trim();
  const submit = async () => {
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(trimmed);
      setText('');
    } catch (e) {
      setError(errorText(e)); // the text stays in the box
    } finally {
      setBusy(false);
    }
  };
  return (
    <Box>
      <TextField
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
          if (e.key === 'Escape' && onCancel) {
            e.stopPropagation();
            onCancel();
          }
        }}
        placeholder={placeholder}
        multiline
        minRows={2}
        maxRows={8}
        fullWidth
        size="small"
        autoFocus={autoFocus}
        disabled={busy}
        inputProps={{ maxLength: COMMENT_BODY_MAX_LENGTH, 'aria-label': placeholder }}
      />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.75 }}>
        {error && (
          <Typography variant="caption" color="error" sx={{ flex: 1 }} role="alert">
            Not posted: {error}
          </Typography>
        )}
        {!error && text.length > COMMENT_BODY_MAX_LENGTH - 1000 && (
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
            {text.length.toLocaleString()} of {COMMENT_BODY_MAX_LENGTH.toLocaleString()}
          </Typography>
        )}
        <Box sx={{ flex: 1 }} />
        {onCancel && (
          <Button size="small" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
        <Button size="small" variant="contained" onClick={submit} disabled={!trimmed || busy}>
          {error ? 'Retry' : submitLabel}
        </Button>
      </Box>
    </Box>
  );
}

function CommentItem({
  comment,
  isNew,
  mine,
  onEdit,
  onDelete,
}: {
  comment: RunComment;
  isNew: boolean;
  mine: boolean;
  onEdit: (body: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (comment.deleted) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', py: 0.5 }}>
        Comment deleted
      </Typography>
    );
  }
  return (
    <Box data-comment-id={comment.id} sx={{ py: 0.75 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
        {isNew && <Box component="span" aria-hidden sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'primary.main', flexShrink: 0, alignSelf: 'center' }} />}
        {isNew && <Box component="span" sx={visuallyHidden}>unread</Box>}
        <Typography variant="body2" sx={{ fontWeight: isNew ? 600 : 500 }}>{comment.authorName}</Typography>
        <Tooltip title={new Date(comment.createdAt).toLocaleString()}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: isNew ? 600 : 400 }}>
            {formatCommentTime(comment.createdAt)}
            {comment.editedAt && ' (edited)'}
          </Typography>
        </Tooltip>
      </Box>
      {editing ? (
        <Box sx={{ mt: 0.5 }}>
          <Composer
            placeholder="Edit comment"
            submitLabel="Save"
            initial={comment.body ?? ''}
            autoFocus
            onSubmit={async (body) => {
              await onEdit(body);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        </Box>
      ) : (
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', mt: 0.25 }}>
          {comment.body}
        </Typography>
      )}
      {mine && !editing && (
        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', mt: 0.25 }}>
          {confirming ? (
            <>
              <Typography variant="caption">Delete this comment?</Typography>
              <Button size="small" color="error" onClick={() => onDelete().catch((e) => { setError(errorText(e)); setConfirming(false); })}>
                Delete
              </Button>
              <Button size="small" onClick={() => setConfirming(false)}>Keep</Button>
            </>
          ) : (
            <>
              <Button size="small" sx={{ minWidth: 0, px: 0.75 }} onClick={() => setEditing(true)}>Edit</Button>
              <Button size="small" sx={{ minWidth: 0, px: 0.75 }} onClick={() => setConfirming(true)}>Delete</Button>
            </>
          )}
          {error && <Typography variant="caption" color="error">Couldn&apos;t delete: {error}</Typography>}
        </Box>
      )}
    </Box>
  );
}

const visuallyHidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;

/**
 * The comments panel of the card whose badge was clicked (design DR1-DR13). CardComments renders
 * it inside that card's expanded grid cell, beside the card at >= 1200px and below it otherwise,
 * so it belongs to the card rather than to the page. One at a time: opening another card's
 * comments moves it there. Threads with unread comments first, then by latest activity; the oldest unread thread
 * starts expanded. "new" marks survive until the drawer closes, while the server is told "seen"
 * as soon as the threads have loaded.
 */
export default function CommentsDrawer() {
  const ctx = useComments();
  const { user } = useAuth();
  const me = user?.id ?? '';
  const card = ctx?.openCard ?? null;
  const runId = ctx?.runId ?? '';

  const [threads, setThreads] = useState<RunCommentThread[] | null>(null);
  const [lastSeenAt, setLastSeenAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [missingFocus, setMissingFocus] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const titleRef = useRef<HTMLHeadingElement>(null);
  const skipFocusFor = useRef<string | null>(null);
  const anchor = ctx?.composeAnchor && ctx.composeAnchor.card === card ? ctx.composeAnchor : null;
  // A new anchor remounts the composer, so a draft for one row never carries over to another.
  const composerIdentity = anchor ? anchor.itemKey : 'card';
  const openerRef = useRef<HTMLElement | null>(null);

  const isNew = useCallback(
    (c: RunComment) => c.authorId !== me && !c.deleted && (!lastSeenAt || c.createdAt > lastSeenAt),
    [me, lastSeenAt],
  );
  const threadHasNew = useCallback((t: RunCommentThread) => isNew(t) || t.replies.some(isNew), [isNew]);

  // Read at load time without reloading the threads whenever the composer's anchor changes.
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;

  const load = useCallback(async () => {
    if (!card) return;
    setThreads(null);
    setError(null);
    try {
      const res = await fetchCommentThreads(runId, card);
      setThreads(res.threads);
      setLastSeenAt(res.lastSeenAt);
      markCommentsSeen(runId, card).catch(() => undefined);
      const focus = ctx?.focusCommentId;
      const focusThread = focus ? res.threads.find((t) => t.id === focus || t.replies.some((r) => r.id === focus)) : undefined;
      setMissingFocus(Boolean(focus && !focusThread));
      const seen = res.lastSeenAt;
      const firstUnread = res.threads.find((t) =>
        [t, ...t.replies].some((c) => c.authorId !== me && !c.deleted && (!seen || c.createdAt > seen)),
      );
      // A card's only thread opens by itself, which also brings its item back (for tracing: the
      // service and its filters). Not while starting a comment on a row: that would move the
      // view away from the row being commented on.
      const onlyThread =
        res.threads.length === 1 && AUTO_OPEN_SINGLE_THREAD.has(card) && !anchorRef.current ? res.threads[0] : undefined;
      setExpanded(focusThread?.id ?? firstUnread?.id ?? onlyThread?.id ?? null);
      if (focusThread) {
        setHighlight(focusThread.id);
        setTimeout(() => setHighlight(null), 2000);
      }
    } catch (e) {
      setError(errorText(e));
    }
  }, [card, runId, me, ctx?.focusCommentId]);

  useEffect(() => {
    if (!card) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    load();
    setTimeout(() => titleRef.current?.focus(), 50);
  }, [card, load]);

  // Apply live events for this card.
  const lastEvent = ctx?.lastEvent;
  useEffect(() => {
    if (!lastEvent || !card || lastEvent.comment.cardKey !== card) return;
    const c = lastEvent.comment;
    setThreads((prev) => {
      if (!prev) return prev;
      if (lastEvent.type === 'comment:deleted' && 'hardDeleted' in c && c.hardDeleted) {
        return prev
          .filter((t) => t.id !== c.id)
          .map((t) => ({ ...t, replies: t.replies.filter((r) => r.id !== c.id) }));
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
    if (lastEvent.type === 'comment:created' && c.authorId !== me) {
      setAnnouncement(`New ${c.parentId ? 'reply' : 'comment'} from ${c.authorName}`);
    }
  }, [lastEvent, card, me]);

  // Opening an anchored thread shows its row: the card expands it and scrolls to it.
  const expandedThread = threads?.find((t) => t.id === expanded);
  const expandedItem = expandedThread?.itemKey ?? null;
  const focusItem = ctx?.focusItem;
  useEffect(() => {
    if (!card || !expanded || !expandedItem || !focusItem) return;
    if (skipFocusFor.current === expanded) {
      skipFocusFor.current = null;
      return;
    }
    focusItem(card, expandedItem);
  }, [card, expanded, expandedItem, focusItem]);

  const close = useCallback(() => {
    ctx?.closeDrawer();
    setThreads(null);
    openerRef.current?.focus?.();
  }, [ctx]);

  const ordered = useMemo(() => {
    if (!threads) return null;
    return [...threads].sort((a, b) => {
      const n = Number(threadHasNew(b)) - Number(threadHasNew(a));
      return n !== 0 ? n : lastActivity(b).localeCompare(lastActivity(a));
    });
  }, [threads, threadHasNew]);

  const upsert = (c: RunComment) =>
    setThreads((prev) =>
      prev
        ? prev.some((t) => t.id === c.id)
          ? prev.map((t) => (t.id === c.id ? { ...t, ...c } : t))
          : c.parentId
            ? prev.map((t) => (t.id === c.parentId ? { ...t, replies: [...t.replies.filter((r) => r.id !== c.id), c] } : { ...t, replies: t.replies.map((r) => (r.id === c.id ? c : r)) }))
            : [...prev, { ...c, replies: [] }]
        : prev,
    );

  const remove = async (c: RunComment) => {
    await deleteComment(c.id);
    // The socket event refines this (soft vs hard); a reload is the fallback when offline.
    if (!ctx?.live) load();
  };

  if (!ctx) return null;
  const label = card ? CARD_LABELS[card] : '';

  const content = card && (
    <Box
      role="complementary"
      aria-label={`Comments on ${label}`}
      sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
      onKeyDown={(e) => e.key === 'Escape' && close()}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', px: 2, py: 1.5 }}>
        <Typography ref={titleRef} tabIndex={-1} variant="subtitle1" sx={{ fontWeight: 600, flex: 1, outline: 'none' }} component="h2">
          Comments · {label}
        </Typography>
        <IconButton aria-label="Close comments" onClick={close} size="small">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>
      {!ctx.live && (
        <Box sx={{ px: 2, py: 0.5, bgcolor: 'action.hover' }}>
          <Typography variant="caption" color="text.secondary">Live updates paused, reconnecting…</Typography>
        </Box>
      )}
      <Box sx={{ px: 2, pb: 1.5 }}>
        {anchor && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.75 }}>
            <Typography variant="caption" color="text.secondary" noWrap sx={{ minWidth: 0 }}>
              On: <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>{anchor.itemLabel}</Box>
            </Typography>
            <IconButton size="small" aria-label="Comment on the whole card instead" onClick={ctx.clearComposeAnchor}>
              <CloseIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Box>
        )}
        <Composer
          key={composerIdentity}
          placeholder={anchor ? `Comment on ${anchor.itemLabel}…` : 'New comment on this card…'}
          submitLabel="Comment"
          autoFocus={Boolean(anchor) || threads?.length === 0}
          onSubmit={async (body) => {
            const c = await postComment(runId, card, body, undefined, anchor ? { itemKey: anchor.itemKey, itemLabel: anchor.itemLabel } : undefined);
            upsert(c);
            skipFocusFor.current = c.id; // the user is already at that row
            setExpanded(c.id);
            ctx.clearComposeAnchor();
          }}
        />
      </Box>
      <Divider />
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 2, py: 1 }}>
        {missingFocus && <Alert severity="info" sx={{ mb: 1 }}>This comment no longer exists.</Alert>}
        {error && (
          <Alert severity="error" action={<Button size="small" onClick={load}>Retry</Button>}>
            Couldn&apos;t load comments
          </Alert>
        )}
        {!error && !ordered && [0, 1, 2].map((i) => <Skeleton key={i} height={48} />)}
        {ordered?.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
            No comments on {label} yet.
          </Typography>
        )}
        {ordered?.map((t) => {
          const open = expanded === t.id;
          const unreadThread = threadHasNew(t);
          return (
            <Box
              key={t.id}
              sx={{
                borderRadius: 1,
                mb: 0.5,
                bgcolor: (theme) =>
                  highlight === t.id ? alpha(theme.palette.primary.main, 0.16) : unreadThread ? alpha(theme.palette.primary.main, 0.06) : 'transparent',
                transition: 'background-color 400ms',
              }}
            >
              <ButtonBase
                onClick={() => setExpanded(open ? null : t.id)}
                aria-expanded={open}
                sx={{ width: '100%', justifyContent: 'flex-start', textAlign: 'left', gap: 1, px: 1, py: 1, minHeight: 44, borderRadius: 1 }}
              >
                {t.markerSeq !== null ? (
                  <Box sx={{ width: 20, height: 20, borderRadius: '50%', border: 1.5, borderColor: 'primary.main', fontSize: 11, fontWeight: 700, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                    {t.markerSeq}
                  </Box>
                ) : (
                  <ChatBubbleOutlineIcon sx={{ fontSize: 16, color: 'text.secondary', flexShrink: 0 }} />
                )}
                <Typography variant="body2" sx={{ fontWeight: unreadThread ? 600 : 500, flexShrink: 0 }}>{t.authorName}</Typography>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  {t.itemLabel && (
                    <Typography variant="caption" color="primary" noWrap component="div" sx={{ fontWeight: 600 }}>
                      {t.itemLabel}
                    </Typography>
                  )}
                  <Typography variant="body2" color="text.secondary" noWrap>
                    {t.deleted ? 'Comment deleted' : t.body}
                  </Typography>
                </Box>
                {t.replies.length > 0 && <Typography variant="caption" color="text.secondary">{t.replies.length}</Typography>}
                <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>{formatCommentTime(lastActivity(t))}</Typography>
                {unreadThread && <Box aria-label="unread" sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'primary.main', flexShrink: 0 }} />}
              </ButtonBase>
              {open && (
                <Box sx={{ px: 1, pb: 1.5 }}>
                  <CommentItem
                    comment={t}
                    isNew={isNew(t)}
                    mine={t.authorId === me}
                    onEdit={async (body) => upsert(await editComment(t.id, body))}
                    onDelete={() => remove(t)}
                  />
                  <Box sx={{ pl: 2, borderLeft: 1, borderColor: 'divider', ml: 0.5 }}>
                    {t.replies.map((r) => (
                      <CommentItem
                        key={r.id}
                        comment={r}
                        isNew={isNew(r)}
                        mine={r.authorId === me}
                        onEdit={async (body) => upsert(await editComment(r.id, body))}
                        onDelete={() => remove(r)}
                      />
                    ))}
                  </Box>
                  {!t.deleted && (
                    <Box sx={{ mt: 1 }}>
                      <Composer
                        placeholder="Reply…"
                        submitLabel="Reply"
                        onSubmit={async (body) => upsert(await postComment(runId, card, body, t.id))}
                      />
                    </Box>
                  )}
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
      <Box aria-live="polite" sx={visuallyHidden}>{announcement}</Box>
    </Box>
  );

  return content || null;
}

