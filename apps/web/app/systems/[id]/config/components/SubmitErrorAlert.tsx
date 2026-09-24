'use client';

import { Alert } from '@mui/material';

export interface SubmitErrorAlertProps {
  /** `validationErrors.submit` — the reason the server gave for refusing the save. */
  message?: string;
  /** Clears the message. Without it a stale 409 sits there while the user fixes the field. */
  onDismiss: () => void;
}

/**
 * The server's reason for refusing a save, shown inside a dialog that stays open.
 *
 * Sticky to the bottom of the scrolling `DialogContent` on purpose. Both SLO dialogs are
 * `maxWidth="md" fullWidth` with two stacked form sections, so the content scrolls and the
 * Save button lives in `DialogActions` below the fold. An alert rendered at the top of that
 * content is off-screen for a user who just clicked Save — which is the same "the button
 * stopped doing anything" symptom the alert exists to fix. Pinning it to the bottom edge puts
 * it next to the control that produced it, whatever the scroll position.
 */
export function SubmitErrorAlert({ message, onDismiss }: SubmitErrorAlertProps) {
  if (!message) return null;
  return (
    <Alert
      severity="error"
      onClose={onDismiss}
      sx={{
        position: 'sticky',
        bottom: 0,
        zIndex: 1,
        mt: 2,
        // The dialog content scrolls behind it, so it needs its own opaque backdrop.
        boxShadow: 3,
      }}
    >
      {message}
    </Alert>
  );
}
