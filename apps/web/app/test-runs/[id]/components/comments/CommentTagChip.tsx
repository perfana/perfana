'use client';

import React from 'react';
import { Box, ButtonBase } from '@mui/material';
import { alpha, type Theme } from '@mui/material/styles';
import type { SvgIconComponent } from '@mui/icons-material';
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import DoNotDisturbOnOutlinedIcon from '@mui/icons-material/DoNotDisturbOnOutlined';
import GpsFixedIcon from '@mui/icons-material/GpsFixed';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import { COMMENT_TAG_LABELS, isCommentTag, type CommentTag } from '@perfana/shared/constants/comment-cards';
import { readableShade, type ReadableKey } from '@/lib/theme';

/**
 * How each analysis tag looks (design: test-run-analysis-stories.md, "Tags"). The text colour is
 * the mode-correct `readable` shade (a `.dark` shade fades out in dark mode, apps/web/CLAUDE.md);
 * the tint behind it is `alpha()` of the opaque `.main`, never of a translucent token. "Ruled out"
 * is deliberately neutral: a check that found nothing should not shout.
 */
export const COMMENT_TAG_STYLE: Readonly<Record<CommentTag, { icon: SvgIconComponent; color: ReadableKey | null }>> = {
  symptom: { icon: ReportProblemOutlinedIcon, color: 'warning' },
  hypothesis: { icon: HelpOutlineIcon, color: 'info' },
  evidence: { icon: FactCheckOutlinedIcon, color: 'primary' },
  'ruled-out': { icon: DoNotDisturbOnOutlinedIcon, color: null },
  'root-cause': { icon: GpsFixedIcon, color: 'error' },
  action: { icon: TaskAltIcon, color: 'success' },
};

export const tagInk = (theme: Theme, tag: CommentTag): string => {
  const key = COMMENT_TAG_STYLE[tag].color;
  return key ? readableShade(theme, key) : theme.palette.text.secondary;
};

const tagTint = (theme: Theme, tag: CommentTag): string => {
  const key = COMMENT_TAG_STYLE[tag].color;
  return key ? alpha(theme.palette[key].main, 0.12) : theme.palette.action.hover;
};

/**
 * A root comment's tag: icon plus label. Renders nothing for an untagged comment or a key this
 * build does not know (a newer server's vocabulary). With `onClick` it is a button (the comments
 * card filters by it); `selected` marks it pressed.
 */
export function CommentTagChip({
  tag,
  onClick,
  selected,
}: {
  tag: string | null | undefined;
  onClick?: (tag: CommentTag) => void;
  selected?: boolean;
}) {
  if (!isCommentTag(tag)) return null;
  const Icon = COMMENT_TAG_STYLE[tag].icon;
  const label = COMMENT_TAG_LABELS[tag];
  const sx = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 0.5,
    px: 0.75,
    py: 0.125,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 600,
    lineHeight: 1.6,
    whiteSpace: 'nowrap' as const,
    color: (theme: Theme) => tagInk(theme, tag),
    bgcolor: (theme: Theme) => tagTint(theme, tag),
    border: 1,
    borderColor: selected ? 'currentColor' : 'transparent',
  };
  const content = (
    <>
      <Icon sx={{ fontSize: 13 }} aria-hidden />
      {label}
    </>
  );
  if (onClick) {
    return (
      <ButtonBase data-comment-tag={tag} aria-pressed={selected ?? false} onClick={() => onClick(tag)} sx={sx}>
        {content}
      </ButtonBase>
    );
  }
  return (
    <Box component="span" data-comment-tag={tag} sx={sx}>
      {content}
    </Box>
  );
}
