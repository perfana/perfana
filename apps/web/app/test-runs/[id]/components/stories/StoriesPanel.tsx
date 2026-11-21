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
 * The Comments card's Stories tab: the run's published stories and the caller's own drafts, with
 * Read, Edit (author) and Delete (author or admin); the editor opens in place. Refetched on every
 * `story:changed` for the run, since the socket carries no story content.
 */
export function StoriesPanel() {
  const ctx = useComments();
  const runId = ctx?.runId;
  const storyEvent = ctx?.storyEvent?.seq ?? 0;
  const [stories, setStories] = useState<RunStorySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const openStory = useOpenStory();

  useEffect(() => {
    if (!runId) return;
    let live = true;
    fetchStories(runId)
      .then((s) => {
        if (!live) return;
        setStories(s);
        setError(null);
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : 'Loading stories failed'));
    return () => {
      live = false;
    };
  }, [runId, storyEvent, editing]);

  if (editing) return <StoryEditor storyId={editing} onClose={() => setEditing(null)} onRead={openStory} />;

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        A story walks a reader through comments in your order: each step opens the card, row or chart view the comment is
        about. Start one with “Add to story” on a comment.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
      {!stories && !error && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <CircularProgress size={24} aria-label="Loading stories" />
        </Box>
      )}
      {stories && stories.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
          No stories on this run yet.
        </Typography>
      )}
      {stories && stories.length > 0 && (
        <Box component="ul" aria-label="Stories" sx={{ listStyle: 'none', p: 0, m: 0 }}>
          {stories.map((s) => (
            <Box
              component="li"
              key={s.id}
              data-testid="story-row"
              sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, py: 1.25, borderTop: 1, borderColor: 'divider' }}
            >
              <Box sx={{ flex: '1 1 260px', minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{s.title}</Typography>
                  <Chip size="small" variant="outlined" label={s.status === 'published' ? 'Published' : 'Draft'} color={s.status === 'published' ? 'success' : 'default'} />
                </Box>
                <Typography variant="caption" color="text.secondary">
                  {s.authorName} · {s.stepCount} {s.stepCount === 1 ? 'step' : 'steps'} · {formatCommentTime(s.publishedAt ?? s.createdAt)}
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
