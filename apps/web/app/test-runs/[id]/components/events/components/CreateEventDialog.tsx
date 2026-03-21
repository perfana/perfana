'use client';

import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Chip,
} from '@mui/material';
import { createEvent } from '@/lib/events';

interface CreateEventDialogProps {
  open: boolean;
  onClose: () => void;
  systemUnderTest: string;
  testEnvironment: string;
  onCreated: () => void;
  showToast: (message: string) => void;
}

export default function CreateEventDialog({
  open,
  onClose,
  systemUnderTest,
  testEnvironment,
  onCreated,
  showToast,
}: CreateEventDialogProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [timestamp, setTimestamp] = useState(() => {
    const now = new Date();
    // Format as datetime-local value: YYYY-MM-DDTHH:MM
    return now.toISOString().slice(0, 16);
  });
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const handleAddTag = () => {
    const tag = tagInput.trim();
    if (tag && !tags.includes(tag)) {
      setTags([...tags, tag]);
      setTagInput('');
    }
  };

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
    }
  };

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setSubmitting(true);

    try {
      await createEvent({
        title: title.trim(),
        description: description.trim() || undefined,
        systemUnderTest,
        testEnvironment,
        timestamp: new Date(timestamp).toISOString(),
        tags: tags.length > 0 ? tags : undefined,
      });

      showToast('Event created');
      onCreated();
      handleClose();
    } catch (err) {
      const msg = err && typeof err === 'object' && 'message' in err
        ? (err as Error).message
        : 'Failed to create event';
      showToast(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setTitle('');
    setDescription('');
    setTimestamp(new Date().toISOString().slice(0, 16));
    setTagInput('');
    setTags([]);
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Create Event</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            fullWidth
            autoFocus
            size="small"
          />
          <TextField
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
            multiline
            rows={2}
            size="small"
          />
          <TextField
            label="Timestamp"
            type="datetime-local"
            value={timestamp}
            onChange={(e) => setTimestamp(e.target.value)}
            required
            fullWidth
            size="small"
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <Box>
            <TextField
              label="Tags (press Enter to add)"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              onBlur={handleAddTag}
              fullWidth
              size="small"
            />
            {tags.length > 0 && (
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 1 }}>
                {tags.map((tag) => (
                  <Chip key={tag} label={tag} size="small" onDelete={() => handleRemoveTag(tag)} />
                ))}
              </Box>
            )}
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={submitting}>Cancel</Button>
        <Button onClick={handleSubmit} variant="contained" disabled={submitting || !title.trim()}>
          {submitting ? 'Creating...' : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
