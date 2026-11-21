'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import CloseIcon from '@mui/icons-material/Close';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  STORY_STEP_NOTE_MAX_LENGTH,
  STORY_SUMMARY_MAX_LENGTH,
  STORY_TITLE_MAX_LENGTH,
  suggestStoryOrder,
} from '@perfana/shared/constants/comment-cards';
import { ClearDragWhenIdle } from '@/components/dnd/ClearDragWhenIdle';
import {
  deleteStory,
  fetchStory,
  replaceStorySteps,
  updateStory,
  type RunStory,
  type RunStoryStep,
} from '@/lib/test-run-stories';
import { CommentTagChip } from '../comments/CommentTagChip';
import { firstLine, stepWhere, tagOf } from './story-format';
import { StoryAuthorLine, storyStatusLabel } from './StoryAuthorLine';
import CommentAuthor from '../comments/CommentAuthor';

interface DraftStep {
  commentId: string;
  note: string;
  comment: RunStoryStep['comment'];
}

const toDraft = (story: RunStory): DraftStep[] =>
  story.steps.map((s) => ({ commentId: s.comment.id, note: s.note ?? '', comment: s.comment }));
const message = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');
const sameSteps = (a: DraftStep[], b: DraftStep[]) =>
  a.length === b.length && a.every((s, i) => s.commentId === b[i]!.commentId && s.note.trim() === b[i]!.note.trim());

/**
 * The story editor (design: "Authoring"): title, conclusion and the ordered steps, with
 * drag-to-reorder (dnd-kit, as the report builder), up/down buttons for the keyboard, a note per
 * step and remove. "Suggest order" sorts once by tag then time. Saving sends the title and summary
 * with PATCH and the whole step list with one PUT, so a reorder is never half-applied.
 */
export function StoryEditor({ storyId, onClose, onRead }: { storyId: string; onClose: () => void; onRead: (id: string) => void }) {
  const [story, setStory] = useState<RunStory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [steps, setSteps] = useState<DraftStep[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dragging, setDragging] = useState(false);
  const clearDrag = useCallback(() => setDragging(false), []);

  const load = useCallback((s: RunStory) => {
    setStory(s);
    setTitle(s.title);
    setSummary(s.summary ?? '');
    setSteps(toDraft(s));
  }, []);

  useEffect(() => {
    let live = true;
    setError(null);
    fetchStory(storyId)
      .then((s) => live && load(s))
      .catch((e: unknown) => live && setError(message(e)));
    return () => {
      live = false;
    };
  }, [storyId, load]);

  const dirty = useMemo(() => {
    if (!story) return false;
    return title.trim() !== story.title || summary.trim() !== (story.summary ?? '').trim() || !sameSteps(steps, toDraft(story));
  }, [story, title, summary, steps]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const move = (from: number, to: number) => {
    if (to < 0 || to >= steps.length) return;
    setSteps((prev) => arrayMove(prev, from, to));
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(false);
    if (!over || active.id === over.id) return;
    const from = steps.findIndex((s) => s.commentId === active.id);
    const to = steps.findIndex((s) => s.commentId === over.id);
    if (from >= 0 && to >= 0) move(from, to);
  };

  /** Save what changed; returns the saved story, or null when it failed. */
  const save = async (): Promise<RunStory | null> => {
    if (!story) return null;
    setBusy(true);
    setError(null);
    try {
      let saved = story;
      if (!sameSteps(steps, toDraft(story))) {
        saved = await replaceStorySteps(story.id, steps.map((s) => ({ commentId: s.commentId, note: s.note.trim() ? s.note : null })));
      }
      const patch: { title?: string; summary?: string | null } = {};
      if (title.trim() !== saved.title) patch.title = title.trim();
      if (summary.trim() !== (saved.summary ?? '').trim()) patch.summary = summary.trim() ? summary : null;
      if (Object.keys(patch).length) saved = await updateStory(story.id, patch);
      load(saved);
      return saved;
    } catch (e) {
      setError(message(e));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (status: 'draft' | 'published') => {
    const saved = dirty ? await save() : story;
    if (!saved) return;
    setBusy(true);
    try {
      load(await updateStory(saved.id, { status }));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!story) return;
    setBusy(true);
    try {
      await deleteStory(story.id);
      onClose();
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  };

  if (!story) {
    return error ? (
      <Box>
        <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>
        <Button size="small" onClick={onClose}>Back to stories</Button>
      </Box>
    ) : (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
        <CircularProgress size={24} aria-label="Loading story" />
      </Box>
    );
  }

  const published = story.status === 'published';
  const agentStory = story.authorKind === 'agent';
  return (
    <Box data-testid="story-editor" sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Button size="small" onClick={onClose}>‹ Stories</Button>
        <Chip size="small" label={storyStatusLabel(story)} color={published ? 'success' : agentStory ? 'info' : 'default'} variant="outlined" />
        {dirty && <Typography variant="caption" color="text.secondary">Unsaved changes</Typography>}
      </Box>
      <Typography variant="caption" color="text.secondary" data-testid="story-editor-author">
        <StoryAuthorLine story={story} />
      </Typography>
      {agentStory && !published && (
        <Alert severity="info" data-testid="story-agent-review">
          An AI agent proposed this story and nobody has reviewed it yet. Check each step against the run before you publish it:
          publishing names you as the reviewer.
        </Alert>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      <TextField
        size="small"
        label="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        inputProps={{ maxLength: STORY_TITLE_MAX_LENGTH }}
        error={!title.trim()}
        helperText={!title.trim() ? 'A story needs a title' : ' '}
      />
      <TextField
        size="small"
        label="Conclusion"
        placeholder="What the analysis found, shown as the story's last screen"
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        multiline
        minRows={2}
        inputProps={{ maxLength: STORY_SUMMARY_MAX_LENGTH }}
      />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          Steps ({steps.length})
        </Typography>
        <Tooltip title="Sort by tag (symptom first, action last), then by when each comment was written. You can reorder afterwards.">
          <span>
            <Button size="small" disabled={steps.length < 2 || busy} onClick={() => setSteps((prev) => suggestStoryOrder(prev.map((s) => ({ ...s, tag: tagOf(s.comment), createdAt: s.comment.createdAt }))))}>
              Suggest order
            </Button>
          </span>
        </Tooltip>
      </Box>
      {steps.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
          No steps yet. Use “Add to story” on a comment, in All comments or in a card’s comments.
        </Typography>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={() => setDragging(true)}
          onDragEnd={onDragEnd}
          onDragCancel={clearDrag}
        >
          <ClearDragWhenIdle dragging={dragging} onIdle={clearDrag} />
          <SortableContext items={steps.map((s) => s.commentId)} strategy={verticalListSortingStrategy}>
            <Box component="ol" aria-label="Story steps" sx={{ listStyle: 'none', p: 0, m: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
              {steps.map((s, i) => (
                <SortableStep
                  key={s.commentId}
                  step={s}
                  index={i}
                  count={steps.length}
                  disabled={busy}
                  onMove={move}
                  onNote={(note) => setSteps((prev) => prev.map((p) => (p.commentId === s.commentId ? { ...p, note } : p)))}
                  onRemove={() => setSteps((prev) => prev.filter((p) => p.commentId !== s.commentId))}
                />
              ))}
            </Box>
          </SortableContext>
        </DndContext>
      )}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button variant="contained" size="small" disabled={!dirty || busy || !title.trim()} onClick={() => void save()}>
          Save
        </Button>
        {published ? (
          <Button size="small" variant="outlined" disabled={busy || !title.trim()} onClick={() => void setStatus('draft')}>
            Unpublish
          </Button>
        ) : (
          <Tooltip
            title={
              steps.length === 0
                ? 'Add at least one step before publishing'
                : agentStory
                  ? 'Publishing names you as its reviewer; everyone who can see this run can read it'
                  : 'Everyone who can see this run can read it'
            }
          >
            <span>
              <Button size="small" variant="outlined" disabled={busy || steps.length === 0 || !title.trim()} onClick={() => void setStatus('published')}>
                {dirty ? 'Save and publish' : 'Publish'}
              </Button>
            </span>
          </Tooltip>
        )}
        <Button size="small" disabled={story.steps.length === 0 || dirty} onClick={() => onRead(story.id)}>
          Read
        </Button>
        <Box sx={{ flex: 1 }} />
        {!story.canDelete ? null : confirmDelete ? (
          <>
            <Typography variant="caption">Delete this story? Its comments stay.</Typography>
            <Button size="small" color="error" disabled={busy} onClick={() => void remove()}>Delete</Button>
            <Button size="small" onClick={() => setConfirmDelete(false)}>Keep</Button>
          </>
        ) : (
          <Button size="small" color="error" disabled={busy} onClick={() => setConfirmDelete(true)}>Delete story</Button>
        )}
      </Box>
    </Box>
  );
}

function SortableStep({
  step,
  index,
  count,
  disabled,
  onMove,
  onNote,
  onRemove,
}: {
  step: DraftStep;
  index: number;
  count: number;
  disabled: boolean;
  onMove: (from: number, to: number) => void;
  onNote: (note: string) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: step.commentId, disabled });
  const tag = tagOf(step.comment);
  const where = stepWhere(step.comment);
  return (
    <Box
      component="li"
      ref={setNodeRef}
      data-testid="story-editor-step"
      data-comment-id={step.commentId}
      sx={{
        transform: CSS.Transform.toString(transform),
        transition,
        display: 'flex',
        gap: 1,
        alignItems: 'flex-start',
        p: 1,
        border: 1,
        borderColor: isDragging ? 'primary.main' : 'divider',
        borderRadius: 2,
        bgcolor: 'background.paper',
        position: 'relative',
        zIndex: isDragging ? 1 : 'auto',
      }}
    >
      <IconButton
        size="small"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Drag step ${index + 1} to reorder`}
        sx={{ cursor: 'grab', mt: 0.25 }}
      >
        <DragIndicatorIcon fontSize="small" />
      </IconButton>
      <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 20, mt: 0.75, fontVariantNumeric: 'tabular-nums' }}>{index + 1}</Typography>
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', minWidth: 0 }}>
          {tag && <CommentTagChip tag={tag} />}
          <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{where}</Typography>
          <CommentAuthor name={step.comment.authorName} kind={step.comment.authorKind} variant="caption" sx={{ color: 'text.secondary' }} />
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere', fontStyle: step.comment.deleted ? 'italic' : 'normal' }}>
          {firstLine(step.comment)}
        </Typography>
        <TextField
          size="small"
          placeholder="Note for this step (optional), e.g. “so I looked at the hosts…”"
          value={step.note}
          onChange={(e) => onNote(e.target.value)}
          inputProps={{ maxLength: STORY_STEP_NOTE_MAX_LENGTH, 'aria-label': `Note for step ${index + 1}` }}
          multiline
          maxRows={4}
        />
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column' }}>
        <IconButton size="small" aria-label={`Move step ${index + 1} up`} disabled={disabled || index === 0} onClick={() => onMove(index, index - 1)}>
          <ArrowUpwardIcon fontSize="small" />
        </IconButton>
        <IconButton size="small" aria-label={`Move step ${index + 1} down`} disabled={disabled || index === count - 1} onClick={() => onMove(index, index + 1)}>
          <ArrowDownwardIcon fontSize="small" />
        </IconButton>
        <IconButton size="small" aria-label={`Remove step ${index + 1}`} disabled={disabled} onClick={onRemove}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>
    </Box>
  );
}
