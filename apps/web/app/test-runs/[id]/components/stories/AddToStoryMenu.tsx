'use client';

import React, { useState } from 'react';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Snackbar from '@mui/material/Snackbar';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import { STORY_TITLE_MAX_LENGTH } from '@perfana/shared/constants/comment-cards';
import { addCommentToStory, createStory, fetchStories, type RunStorySummary } from '@/lib/test-run-stories';
import { useComments } from '../comments/CommentsContext';

const message = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

/**
 * "Add to story ▾" on a root comment (design: "Authoring"): the caller's own stories on this run,
 * then "New story…", which asks only for a title and starts a draft with this comment as its first
 * step. Only stories the caller edits are offered; a comment already in one says so.
 */
export function AddToStoryMenu({ commentId, label }: { commentId: string; label?: string }) {
  const ctx = useComments();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [stories, setStories] = useState<RunStorySummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  if (!ctx) return null;

  const open = (el: HTMLElement) => {
    setAnchor(el);
    setStories(null);
    setLoadError(null);
    fetchStories(ctx.runId)
      .then((all) => setStories(all.filter((s) => s.canEdit)))
      .catch((e: unknown) => setLoadError(message(e)));
  };
  const addTo = async (story: RunStorySummary) => {
    setAnchor(null);
    try {
      const { added } = await addCommentToStory(story.id, commentId);
      setToast(added ? `Added to “${story.title}”` : `Already a step of “${story.title}”`);
    } catch (e) {
      setToast(message(e));
    }
  };
  const create = async () => {
    const t = title.trim();
    if (!t) return;
    setBusy(true);
    setDialogError(null);
    try {
      await createStory(ctx.runId, t, [{ commentId }]);
      setNaming(false);
      setTitle('');
      setToast(`Started “${t}”: edit it under Comments (run header) › Stories`);
    } catch (e) {
      setDialogError(message(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        size="small"
        endIcon={<ArrowDropDownIcon />}
        aria-haspopup="menu"
        aria-expanded={anchor ? 'true' : undefined}
        aria-label={label ?? 'Add to story'}
        onClick={(e) => open(e.currentTarget)}
        sx={{ textTransform: 'none', flexShrink: 0 }}
      >
        Add to story
      </Button>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {!stories && !loadError && (
          <MenuItem disabled>
            <CircularProgress size={16} sx={{ mr: 1 }} /> Loading stories…
          </MenuItem>
        )}
        {loadError && <MenuItem disabled>{loadError}</MenuItem>}
        {stories?.map((s) => (
          <MenuItem key={s.id} onClick={() => void addTo(s)}>
            <Typography variant="body2" noWrap sx={{ maxWidth: 280 }}>{s.title}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
              {s.status === 'draft' ? 'draft' : 'published'} · {s.stepCount} {s.stepCount === 1 ? 'step' : 'steps'}
            </Typography>
          </MenuItem>
        ))}
        {stories && stories.length > 0 && <Divider />}
        <MenuItem
          onClick={() => {
            setAnchor(null);
            setNaming(true);
          }}
        >
          New story…
        </MenuItem>
      </Menu>
      <Dialog open={naming} onClose={() => !busy && setNaming(false)} fullWidth maxWidth="xs">
        <DialogTitle>New story</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Starts a draft only you can see, with this comment as its first step.
          </Typography>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="Title"
            value={title}
            inputProps={{ maxLength: STORY_TITLE_MAX_LENGTH }}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void create();
            }}
            error={Boolean(dialogError)}
            helperText={dialogError ?? ' '}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNaming(false)} disabled={busy}>Cancel</Button>
          <Button variant="contained" onClick={() => void create()} disabled={busy || !title.trim()}>
            Create
          </Button>
        </DialogActions>
      </Dialog>
      <Snackbar open={Boolean(toast)} autoHideDuration={5000} onClose={() => setToast(null)} message={toast ?? ''} />
    </>
  );
}
