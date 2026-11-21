'use client';

import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Tooltip from '@mui/material/Tooltip';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';
import { CARD_LABELS, useComments } from '../CommentsContext';
import { StoriesPanel } from '../../stories/StoriesPanel';
import { AllComments } from './AllComments';

export type RunCommentsTab = 'all' | 'stories';

/**
 * The run's Comments dialog, opened from the header icon: All comments (every root, filters, Show in
 * context, Add to story) and Stories (the list and the editor). Full screen below `sm`.
 *
 * Every action that moves the reader to the page closes the dialog first, so the card, its drawer
 * or the story bar is what they see: Show in context, a story's Read, and Next unread, which does
 * what the old red header button did (reveal the first card in page order with unread comments
 * and open its drawer, which marks it seen). Opening the dialog marks nothing seen.
 */
export function RunCommentsDialog({ open, onClose, initialTab = 'all' }: { open: boolean; onClose: () => void; initialTab?: RunCommentsTab }) {
  const ctx = useComments();
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [tab, setTab] = useState<RunCommentsTab>(initialTab);
  if (!ctx) return null;
  const next = ctx.nextUnreadCard;
  const nextLabel = next ? `Next unread (${ctx.totalUnread})` : null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen={fullScreen}
      fullWidth
      maxWidth="lg"
      PaperProps={{ sx: { minHeight: fullScreen ? undefined : '70vh' } }}
    >
      {/* The title holds only its text: MUI labels the dialog with the title element. */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1.5 }}>
        <DialogTitle sx={{ flex: 1 }}>Comments</DialogTitle>
        {next && nextLabel && (
          <Tooltip title={`Open ${CARD_LABELS[next]} (${ctx.unread[next]} unread)`}>
            <Button
              size="small"
              variant="contained"
              color="error"
              disableElevation
              data-testid="run-comments-next-unread"
              aria-label={`${nextLabel}: ${CARD_LABELS[next]}`}
              onClick={() => {
                onClose();
                ctx.jumpToNextUnread();
              }}
              sx={{ textTransform: 'none', borderRadius: 4 }}
            >
              {nextLabel}
            </Button>
          </Tooltip>
        )}
        <IconButton aria-label="Close comments" onClick={onClose} size="small">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>
      <DialogContent dividers sx={{ pt: 0 }}>
        <Tabs value={tab} onChange={(_, v: RunCommentsTab) => setTab(v)} aria-label="Comments views" sx={{ minHeight: 40, mb: 1.5 }}>
          <Tab value="all" label="All comments" id="run-comments-tab-all" aria-controls="run-comments-panel-all" sx={{ minHeight: 40, textTransform: 'none' }} />
          <Tab value="stories" label="Stories" id="run-comments-tab-stories" aria-controls="run-comments-panel-stories" sx={{ minHeight: 40, textTransform: 'none' }} />
        </Tabs>
        <Box role="tabpanel" id="run-comments-panel-all" aria-labelledby="run-comments-tab-all" hidden={tab !== 'all'}>
          <AllComments
            enabled={open}
            onShow={(t) => {
              onClose();
              ctx.showComment(t.cardKey, t.id);
            }}
          />
        </Box>
        {tab === 'stories' && (
          <Box role="tabpanel" id="run-comments-panel-stories" aria-labelledby="run-comments-tab-stories">
            <StoriesPanel onBeforeRead={onClose} />
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}
