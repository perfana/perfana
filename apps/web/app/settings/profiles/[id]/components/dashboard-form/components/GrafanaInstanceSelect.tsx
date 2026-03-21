'use client';

import { FormControl, InputLabel, Select, MenuItem } from '@mui/material';
import { GrafanaInstance } from '../types';

interface GrafanaInstanceSelectProps {
  value: string;
  instances: GrafanaInstance[];
  disabled: boolean;
  onChange: (value: string) => void;
}

/**
 * Grafana instance selection dropdown
 */
export function GrafanaInstanceSelect({
  value,
  instances,
  disabled,
  onChange,
}: GrafanaInstanceSelectProps) {
  return (
    <FormControl fullWidth required>
      <InputLabel>Grafana Instance</InputLabel>
      <Select
        value={value}
        label="Grafana Instance"
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        {instances.map((instance) => (
          <MenuItem key={instance.id} value={instance.label}>
            {instance.label}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
