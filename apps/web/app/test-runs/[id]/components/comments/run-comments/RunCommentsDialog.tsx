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
import { StoriesPanel, useOpenStory } from '../../stories/StoriesPanel';
import { AllComments } from './AllComments';

export type RunCommentsTab = 'all' | 'stories';

/** A tab's text with its unread count beside it; the count is in the tab's accessible name too. */
function TabLabel({ text, unread, testId }: { text: string; unread: number; testId: string }) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
      {text}
      {unread > 0 && (
        <Box
          component="span"
          data-testid={testId}
          sx={{ minWidth: 20, height: 20, px: 0.75, borderRadius: 10, bgcolor: 'error.main', color: 'error.contrastText', fontSize: 12, fontWeight: 600, lineHeight: '20px', textAlign: 'center' }}
        >
          {unread}
        </Box>
      )}
    </Box>
  );
}

/**
 * The run's Comments dialog, opened from the header icon: All comments (every root, filters, Show in
 * context, Add to investigation, the investigations each root is in) and Investigations (the list
 * and the editor; stored as stories). Each tab carries its unread count. Full screen below `sm`.
 *
 * Every action that moves the reader to the page closes the dialog first, so the card, its drawer
 * or the story bar is what they see: Show in context, an investigation's Read (or its chip on a comment), and Next unread, which does
 * what the old red header button did (reveal the first card in page order with unread comments
 * and open its drawer, which marks it seen). Opening the dialog marks nothing seen.
 */
export function RunCommentsDialog({
  open,
  onClose,
  initialTab = 'all',
  storiesUnread = 0,
}: {
  open: boolean;
  onClose: () => void;
  initialTab?: RunCommentsTab;
  /** Investigations unread for the caller, from the header's access-checked list. */
  storiesUnread?: number;
}) {
  const ctx = useComments();
  const openStory = useOpenStory();
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
          <Tab
            value="all"
            label={<TabLabel text="All comments" unread={ctx.totalUnread} testId="run-comments-tab-all-unread" />}
            aria-label={ctx.totalUnread > 0 ? `All comments, ${ctx.totalUnread} unread` : 'All comments'}
            id="run-comments-tab-all"
            aria-controls="run-comments-panel-all"
            sx={{ minHeight: 40, textTransform: 'none' }}
          />
          <Tab
            value="stories"
            label={<TabLabel text="Investigations" unread={storiesUnread} testId="run-comments-tab-stories-unread" />}
            aria-label={storiesUnread > 0 ? `Investigations, ${storiesUnread} unread` : 'Investigations'}
            id="run-comments-tab-stories"
            aria-controls="run-comments-panel-stories"
            sx={{ minHeight: 40, textTransform: 'none' }}
          />
        </Tabs>
        <Box role="tabpanel" id="run-comments-panel-all" aria-labelledby="run-comments-tab-all" hidden={tab !== 'all'}>
          <AllComments
            enabled={open}
            onShow={(t) => {
              onClose();
              ctx.showComment(t.cardKey, t.id);
            }}
            onReadStory={(id) => {
              onClose();
              openStory(id);
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
