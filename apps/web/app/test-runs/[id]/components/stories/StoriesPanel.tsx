'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import { deleteStory, fetchStories, storyHref, type RunStorySummary } from '@/lib/test-run-stories';
import { formatCommentTime } from '@/lib/test-run-comments';
import { useComments } from '../comments/CommentsContext';
import { StoryEditor } from './StoryEditor';
import { StoryAuthorLine, storyStatusLabel } from './StoryAuthorLine';

/** Opens the story reader by putting `?story=<id>` on the page URL (no step = the intro screen). */
export function useOpenStory(): (id: string) => void {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return useCallback(
    (id: string) => router.push(`${pathname}${storyHref(new URLSearchParams(params.toString()), id)}`, { scroll: false }),
    [router, pathname, params],
  );
}

/**
 * The Stories tab of the run's Comments dialog: the run's published stories, AI agents' drafts
 * (labelled `AI draft · not reviewed`, which any user may edit, publish or delete) and the caller's
 * own drafts, with Read, Edit and Delete as the API's `canEdit` / `canDelete` allow; the editor
 * opens in place.
 * Refetched on every `story:changed` for the run, since the socket carries no story content.
 * `onBeforeRead` runs before the reader opens (the dialog closes, so the story bar is visible).
 */
export function StoriesPanel({ onBeforeRead }: { onBeforeRead?: () => void } = {}) {
  const ctx = useComments();
  const runId = ctx?.runId;
  const storyEvent = ctx?.storyEvent?.seq ?? 0;
  const storyRead = ctx?.storyReadSeq ?? 0;
  const [stories, setStories] = useState<RunStorySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const navigate = useOpenStory();
  const openStory = useCallback(
    (id: string) => {
      onBeforeRead?.();
      navigate(id);
    },
    [onBeforeRead, navigate],
  );

  useEffect(() => {
    if (!runId) return;
    let live = true;
    fetchStories(runId)
      .then((s) => {
        if (!live) return;
        setStories(s);
        setError(null);
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : 'Loading investigations failed'));
    return () => {
      live = false;
    };
  }, [runId, storyEvent, storyRead, editing]);

  if (editing) return <StoryEditor storyId={editing} onClose={() => setEditing(null)} onRead={openStory} />;

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        An investigation walks a reader through comments in your order: each step opens the card, row or chart view the
        comment is about. Start one with “Add to investigation” on a comment.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
      {!stories && !error && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <CircularProgress size={24} aria-label="Loading investigations" />
        </Box>
      )}
      {stories && stories.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
          No investigations on this run yet.
        </Typography>
      )}
      {stories && stories.length > 0 && (
        <Box component="ul" aria-label="Investigations" sx={{ listStyle: 'none', p: 0, m: 0 }}>
          {stories.map((s) => (
            <Box
              component="li"
              key={s.id}
              data-testid="story-row"
              data-unread={s.unread ? 'true' : undefined}
              sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, py: 1.25, borderTop: 1, borderColor: 'divider' }}
            >
              <Box sx={{ flex: '1 1 260px', minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  {s.unread && (
                    <Box
                      component="span"
                      role="img"
                      aria-label="Unread"
                      data-testid="story-unread-dot"
                      sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'error.main', flexShrink: 0 }}
                    />
                  )}
                  <Typography variant="body2" sx={{ fontWeight: s.unread ? 700 : 600, overflowWrap: 'anywhere' }}>{s.title}</Typography>
                  <Chip
                    size="small"
                    variant="outlined"
                    label={storyStatusLabel(s)}
                    color={s.status === 'published' ? 'success' : s.authorKind === 'agent' ? 'info' : 'default'}
                  />
                </Box>
                <Typography variant="caption" color="text.secondary">
                  <StoryAuthorLine story={s} /> · {s.stepCount} {s.stepCount === 1 ? 'step' : 'steps'} · {formatCommentTime(s.publishedAt ?? s.createdAt)}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
                <Button size="small" variant="outlined" disabled={s.stepCount === 0} onClick={() => openStory(s.id)} sx={{ textTransform: 'none' }}>
                  Read
                </Button>
                {s.canEdit && (
                  <Button size="small" onClick={() => setEditing(s.id)} sx={{ textTransform: 'none' }}>Edit</Button>
                )}
                {s.canDelete && !s.canEdit && (
                  confirming === s.id ? (
                    <>
                      <Button
                        size="small"
                        color="error"
                        onClick={() => {
                          setConfirming(null);
                          deleteStory(s.id)
                            .then(() => setStories((prev) => prev?.filter((x) => x.id !== s.id) ?? prev))
                            .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Deleting failed'));
                        }}
                      >
                        Delete
                      </Button>
                      <Button size="small" onClick={() => setConfirming(null)}>Keep</Button>
                    </>
                  ) : (
                    <Button size="small" color="error" onClick={() => setConfirming(s.id)} sx={{ textTransform: 'none' }}>Delete</Button>
                  )
                )}
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
