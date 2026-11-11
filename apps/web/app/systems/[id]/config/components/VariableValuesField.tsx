import { useState } from 'react';
import { Autocomplete, TextField, CircularProgress, Chip } from '@mui/material';
import { DashboardVariableOption } from '@/lib/types';

type Option = DashboardVariableOption | string;

interface VariableValuesFieldProps {
  name: string;
  label?: string;
  value: string[];
  onChange: (values: string[]) => void;
  options: Option[];
  loading?: boolean;
  /** Set once the value lookup has finished; undefined while it has not run yet. */
  optionsLoaded?: boolean;
  /** Why Grafana could not answer, from the API's error message. */
  fetchError?: string;
  query?: string | { query?: string };
}

const optionValue = (o: Option) => (typeof o === 'string' ? o : o.value);

/** The reason a failed POST /grafana/dashboards/variable-values gave, or a status fallback. */
export async function variableValuesError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    const message = Array.isArray(body?.message) ? body.message.join(', ') : body?.message;
    if (typeof message === 'string' && message.trim()) return message;
  } catch {
    // not JSON; fall through
  }
  return `request failed (${response.status}${response.statusText ? ` ${response.statusText}` : ''})`;
}

/**
 * Multi-value free-text picker for a Grafana templating variable. Text left in the
 * input is committed when the field loses focus, so a typed value is never dropped
 * because the user moved on (or clicked Save) without pressing Enter.
 */
export default function VariableValuesField({
  name,
  label,
  value,
  onChange,
  options,
  loading = false,
  optionsLoaded = true,
  fetchError,
  query,
}: VariableValuesFieldProps) {
  const [input, setInput] = useState('');

  const commitInput = () => {
    const typed = input.trim();
    if (typed && !value.includes(typed)) onChange([...value, typed]);
    setInput('');
  };

  const queryText = typeof query === 'string' ? query : query?.query;
  const helperText = fetchError
    ? `Could not load values from Grafana: ${fetchError}. Type values manually instead.`
    : optionsLoaded && !loading && options.length === 0
      ? 'Grafana returned no values for this variable. Type values manually instead.'
      : queryText
        ? `Query: ${queryText}`
        : '';

  return (
    <Autocomplete
      multiple
      freeSolo
      loading={loading}
      options={options}
      getOptionLabel={(option) => (typeof option === 'string' ? option : option.label)}
      value={value}
      inputValue={input}
      onInputChange={(_, v) => setInput(v)}
      onBlur={commitInput}
      onChange={(_, newValue) => onChange(newValue.map(optionValue))}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          variant="outlined"
          placeholder={`Select or enter ${name} values`}
          helperText={helperText}
          FormHelperTextProps={{ sx: fetchError ? { color: 'warning.main' } : undefined }}
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {loading ? <CircularProgress size={20} /> : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
      renderTags={(tags, getTagProps) =>
        tags.map((option, index) => (
          <Chip
            variant="outlined"
            label={typeof option === 'string' ? option : option.label || option.value}
            size="small"
            {...getTagProps({ index })}
            key={optionValue(option)}
          />
        ))
      }
    />
  );
}
