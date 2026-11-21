'use client';

import React from 'react';
import { MenuItem, Select, Typography } from '@mui/material';
import { COMMENT_TAGS, isCommentTag, type CommentTag } from '@perfana/shared/constants/comment-cards';
import { CommentTagChip } from './CommentTagChip';

const NONE = '';

/**
 * Picks a root comment's analysis tag, or none. The options follow `COMMENT_TAGS`' order, which
 * is also the suggested story order. Only for roots: a reply never takes a tag.
 */
export function CommentTagPicker({
  value,
  onChange,
  disabled,
}: {
  value: CommentTag | null;
  onChange: (tag: CommentTag | null) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      size="small"
      variant="standard"
      disableUnderline
      displayEmpty
      disabled={disabled}
      value={value ?? NONE}
      onChange={(e) => onChange(isCommentTag(e.target.value) ? e.target.value : null)}
      // The combobox is the display div, not the hidden input, so its name goes here.
      SelectDisplayProps={{ 'aria-label': 'Comment tag' } as React.HTMLAttributes<HTMLDivElement>}
      renderValue={(v) =>
        isCommentTag(v) ? (
          <CommentTagChip tag={v} />
        ) : (
          <Typography component="span" variant="caption" color="text.secondary">
            Add tag
          </Typography>
        )
      }
      sx={{ fontSize: 12, '& .MuiSelect-select': { py: 0.25, display: 'flex', alignItems: 'center' } }}
    >
      <MenuItem value={NONE}>
        <Typography variant="caption" color="text.secondary">No tag</Typography>
      </MenuItem>
      {COMMENT_TAGS.map((t) => (
        <MenuItem key={t} value={t}>
          <CommentTagChip tag={t} />
        </MenuItem>
      ))}
    </Select>
  );
}
