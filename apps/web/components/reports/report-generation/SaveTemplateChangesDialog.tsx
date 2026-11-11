'use client';

import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material';

/** What the user was doing when the builder asked: it decides the wording and what happens next. */
export type TemplateChangesExit = 'generate' | 'close' | 'back-to-templates';

export interface SaveTemplateChangesDialogProps {
  /** Null while closed. */
  exit: TemplateChangesExit | null;
  templateName: string;
  saving: boolean;
  error: string | null;
  /** Write the builder's sections back to the template, then carry on with `exit`. */
  onSave: () => void;
  /** Carry on with `exit` and leave the template as it is. */
  onDiscard: () => void;
  /** Back to the builder, nothing done. */
  onKeepEditing: () => void;
}

const COPY: Record<TemplateChangesExit, { body: string; discard: string; save: string }> = {
  generate: {
    body: 'You changed sections of this report. Do you want to save those changes to the template as well? The report is generated either way.',
    discard: 'Generate without saving',
    save: 'Save and generate',
  },
  close: {
    body: 'You changed sections of this report. Do you want to save those changes to the template before closing? Otherwise they are lost.',
    discard: 'Discard changes',
    save: 'Save to template',
  },
  'back-to-templates': {
    body: 'You changed sections of this report. Do you want to save those changes to the template before choosing another starting point? Otherwise they are lost.',
    discard: 'Discard changes',
    save: 'Save to template',
  },
};

/**
 * Asked when a report built from a template is about to be generated or left with changes on top
 * of that template. Saving overwrites the template's sections for everyone who uses it.
 */
export function SaveTemplateChangesDialog({
  exit,
  templateName,
  saving,
  error,
  onSave,
  onDiscard,
  onKeepEditing,
}: SaveTemplateChangesDialogProps) {
  // Keep the last wording through the close animation rather than flashing another one.
  const copy = COPY[exit ?? 'close'];
  return (
    <Dialog
      open={exit !== null}
      onClose={saving ? undefined : onKeepEditing}
      maxWidth="sm"
      fullWidth
      aria-labelledby="save-template-changes-title"
      aria-describedby="save-template-changes-description"
    >
      <DialogTitle id="save-template-changes-title">
        Save changes to &ldquo;{templateName}&rdquo;?
      </DialogTitle>
      <DialogContent>
        <DialogContentText id="save-template-changes-description">{copy.body}</DialogContentText>
        <DialogContentText variant="body2" sx={{ mt: 1.5 }}>
          Saving updates the template for every future report that starts from it.
        </DialogContentText>
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            Could not save the template: {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Button onClick={onKeepEditing} disabled={saving} sx={{ textTransform: 'none', mr: 'auto' }}>
          Keep editing
        </Button>
        <Button onClick={onDiscard} disabled={saving} color="inherit" sx={{ textTransform: 'none' }}>
          {copy.discard}
        </Button>
        <Button
          variant="contained"
          onClick={onSave}
          disabled={saving}
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
          sx={{ textTransform: 'none' }}
        >
          {saving ? 'Saving...' : copy.save}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
