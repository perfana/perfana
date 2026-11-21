'use client';

import React from 'react';
import Chip from '@mui/material/Chip';
import { COMMENT_TAG_LABELS, type CommentTag } from '@perfana/shared/constants/comment-cards';

/**
 * A comment's analysis tag. Deliberately minimal and kept in one place: the tags PR brings the
 * shared chip (icon and `readable` colour per tag), which replaces this one.
 */
export default function CommentTagChip({
  tag,
  selected = false,
  onClick,
  ariaLabel,
}: {
  tag: CommentTag;
  selected?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
}) {
  return (
    <Chip
      size="small"
      label={COMMENT_TAG_LABELS[tag]}
      color={selected ? 'primary' : 'default'}
      variant={selected ? 'filled' : 'outlined'}
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={onClick ? selected : undefined}
      sx={{ height: 22, fontSize: '0.75rem', fontWeight: 600, flexShrink: 0 }}
    />
  );
}
