'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from '@mui/material';
import type { Profile } from '@/lib/profiles';
import { mergeSystemProfileTags, visibleProfileTags } from '../profile-tags';

export interface ProfileFormValues {
  /** Trimmed, for create. An edit must NOT send this — see the note on the name field below. */
  name: string;
  /** Exactly what is in the box, untrimmed, so a caller can tell "unchanged" from "emptied". */
  description: string;
  tags: string[];
}

interface ProfileFormDialogProps {
  open: boolean;
  /** The profile being edited, or null to create a new one. */
  profile: Profile | null;
  /** Tags already used by other profiles, offered as suggestions. */
  tagSuggestions?: string[];
  saving: boolean;
  /**
   * Why the last save failed, shown inside the dialog.
   *
   * It has to render HERE, not on the page behind: MUI puts the app root under `aria-hidden` and a
   * backdrop while the dialog is open, so a page-level Alert is both covered and invisible to a
   * screen reader. Every sibling dialog in this app puts its error in `DialogContent`.
   */
  error?: string;
  onClose: () => void;
  onSubmit: (values: ProfileFormValues) => void;
}

/**
 * Create or edit a profile. One dialog for both, because the fields are the same three and a
 * second copy would be the drift that left `tags` out of create in the first place.
 *
 * The tags field shows only the user-facing tags (`visibleProfileTags`) and merges the hidden
 * system ones back on submit, so saving cannot delete a tag the dialog never showed.
 *
 * The name is read-only when editing. `profile_grafana_dashboards.profile` and
 * `generic_deep_links.profile` reference a profile by NAME with no foreign key, and the API's
 * `updateProfile` does not rewrite either, so a rename here would silently orphan the profile's
 * dashboards and deep links. See TODOS.md, "Renaming a profile from the UI".
 */
export function ProfileFormDialog({
  open,
  profile,
  tagSuggestions = [],
  saving,
  error,
  onClose,
  onSubmit,
}: ProfileFormDialogProps) {
  const isEdit = profile !== null;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);

  // Reset from the profile every time the dialog opens, so a cancelled edit does not leak into
  // the next one and a create dialog never opens pre-filled from a previous edit.
  useEffect(() => {
    if (!open) {return;}
    setName(profile?.name ?? '');
    setDescription(profile?.description ?? '');
    setTags(visibleProfileTags(profile?.tags));
  }, [open, profile]);

  const options = useMemo(
    () => Array.from(new Set(visibleProfileTags(tagSuggestions))).sort((a, b) => a.localeCompare(b)),
    [tagSuggestions]
  );

  const trimmedName = name.trim();
  // An edit does not submit the name at all, so a stored name that is blank or all whitespace
  // must not disable Save — the one field that could fix it is read-only.
  const canSubmit = (isEdit || trimmedName.length > 0) && !saving;

  const handleSubmit = () => {
    if (!canSubmit) {return;}
    onSubmit({
      name: trimmedName,
      description,
      tags: mergeSystemProfileTags(tags, profile?.tags),
    });
  };

  return (
    <Dialog
      open={open}
      // Not dismissible mid-save: the submit button is already disabled, and a backdrop click or
      // Escape would drop the user on a surface the outcome can no longer reach.
      onClose={saving ? undefined : onClose}
      disableEscapeKeyDown={saving}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>{isEdit ? `Edit ${profile?.name}` : 'Create New Profile'}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mt: 1, mb: 2 }}>
            {error}
          </Alert>
        )}
        <TextField
          autoFocus={!isEdit}
          margin="dense"
          label="Profile Name"
          fullWidth
          required
          disabled={isEdit}
          helperText={isEdit ? 'A profile cannot be renamed: its dashboards and deep links reference it by name.' : undefined}
          value={name}
          onChange={(e) => setName(e.target.value)}
          inputProps={{ 'data-testid': 'profile-name-input' }}
          sx={{ mt: error ? 0 : 1 }}
        />
        <TextField
          // In edit mode the name is read-only, so this is the first field a user can act on.
          autoFocus={isEdit}
          margin="dense"
          label="Description"
          fullWidth
          multiline
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          inputProps={{ 'data-testid': 'profile-description-input' }}
        />
        <Autocomplete
          multiple
          freeSolo
          options={options}
          value={tags}
          onChange={(_, newValue) => setTags(newValue as string[])}
          // MUI's own default tag rendering is this exact Chip; only the size differs from it.
          slotProps={{ chip: { size: 'small' } }}
          renderInput={(params) => (
            <TextField
              {...params}
              margin="dense"
              label="Tags"
              placeholder="Add tags..."
              helperText="Press Enter to add a tag. Tags decide which dashboards and SLOs this profile provisions."
              inputProps={{ ...params.inputProps, 'data-testid': 'profile-tags-input' }}
            />
          )}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={!canSubmit}
          data-testid="profile-form-submit"
        >
          {saving ? (isEdit ? 'Saving...' : 'Creating...') : isEdit ? 'Save' : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
