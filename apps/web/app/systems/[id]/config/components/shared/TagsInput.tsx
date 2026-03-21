'use client';

import { Autocomplete, TextField, Chip } from '@mui/material';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';

interface TagsInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
  helperText?: string;
}

/**
 * Free-form multi-value tag input using MUI Autocomplete (freeSolo + multiple).
 * Users can type a tag and press Enter or comma to add it; backspace removes the last one.
 */
export function TagsInput({ value, onChange, disabled, helperText }: TagsInputProps) {
  return (
    <Autocomplete
      multiple
      freeSolo
      options={[]}
      value={value}
      disabled={disabled}
      onChange={(_, newValue) => {
        // Trim each tag and deduplicate
        const cleaned = [...new Set(newValue.map((t) => t.trim()).filter(Boolean))];
        onChange(cleaned);
      }}
      renderTags={(tagValues, getTagProps) =>
        tagValues.map((tag, index) => (
          <Chip
            {...getTagProps({ index })}
            key={tag}
            label={tag}
            size="small"
            icon={<LocalOfferIcon sx={{ fontSize: '14px !important' }} />}
            sx={{
              height: 24,
              fontWeight: 600,
              background: 'linear-gradient(135deg, rgba(25, 118, 210, 0.08) 0%, rgba(30, 136, 229, 0.12) 100%)',
              border: '1px solid rgba(25, 118, 210, 0.3)',
              color: 'primary.dark',
              '& .MuiChip-label': { px: 0.75, fontSize: '0.75rem' },
              '& .MuiChip-deleteIcon': { fontSize: '14px' },
            }}
          />
        ))
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label="Tags"
          placeholder={value.length === 0 ? 'Add tags (press Enter)' : ''}
          helperText={helperText ?? 'Optional. Press Enter after each tag to add it.'}
          size="small"
        />
      )}
    />
  );
}
