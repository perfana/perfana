'use client';

import { TextField, InputAdornment, IconButton } from '@mui/material';
import { FilterList, Clear } from '@mui/icons-material';

interface Top10FilterProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

/** Name filter for the Top 10 Lists tabs — matches the transaction filter in the Overview tab. */
export function Top10Filter({ value, onChange, placeholder = 'Filter...' }: Top10FilterProps) {
  return (
    <TextField
      size="small"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      InputProps={{
        startAdornment: (
          <InputAdornment position="start">
            <FilterList sx={{ fontSize: 18, color: 'text.secondary' }} />
          </InputAdornment>
        ),
        endAdornment: value ? (
          <InputAdornment position="end">
            <IconButton size="small" onClick={() => onChange('')}>
              <Clear sx={{ fontSize: 16 }} />
            </IconButton>
          </InputAdornment>
        ) : null,
      }}
      sx={{ width: 300, backgroundColor: 'background.paper', borderRadius: 1 }}
    />
  );
}
