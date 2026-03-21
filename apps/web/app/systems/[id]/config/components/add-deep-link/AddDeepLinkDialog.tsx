'use client';

import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  TextField,
  CircularProgress,
  FormControl,
  InputLabel,
  OutlinedInput,
  FormHelperText,
  ClickAwayListener,
} from '@mui/material';

import { AddDeepLinkDialogProps } from './types';
import { useAddDeepLink } from './hooks';
import { AutocompletePopper, VariablesAccordion } from '../edit-deep-link/components';
import { TagsInput } from '../shared/TagsInput';

export default function AddDeepLinkDialog({
  open,
  onClose,
  onSubmit,
  systemId,
  systemName,
  testEnvironment,
  workload,
  loading,
}: AddDeepLinkDialogProps) {
  const {
    // Form state
    name,
    setName,
    url,
    tags,
    setTags,
    nameError,
    urlError,
    submitting,

    // Available variables
    availableVariables,
    loadingConfigKeys,

    // Autocomplete state
    autocompleteOpen,
    autocompleteAnchor,
    filteredVariables,
    selectedIndex,
    hoveredIndex,
    setHoveredIndex,
    menuListRef,

    // Handlers
    handleUrlChange,
    handleVariableSelect,
    handleAutocompleteClose,
    handleKeyDown,
    handleSubmit,
    insertVariable,
  } = useAddDeepLink({
    open,
    systemId,
    systemName,
    testEnvironment,
    workload,
    onSubmit,
    onClose,
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        Add Deep Link
        <Typography variant="body2" color="text.secondary">
          Create a custom URL link for {systemName} - {testEnvironment} - {workload}
        </Typography>
      </DialogTitle>

      <DialogContent>
        <Box sx={{ pt: 2 }}>
          {/* Name Field */}
          <TextField
            label="Deep Link Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            required
            sx={{ mb: 3 }}
            error={!!nameError}
            helperText={nameError || 'A descriptive name for this deep link'}
            placeholder="e.g., Grafana Dashboard, APM View, Performance Report"
          />

          {/* URL Field with Autocomplete */}
          <ClickAwayListener onClickAway={handleAutocompleteClose}>
            <Box sx={{ position: 'relative' }}>
              <FormControl fullWidth required sx={{ mb: 3 }}>
                <InputLabel htmlFor="url-input" error={!!urlError}>
                  URL
                </InputLabel>
                <OutlinedInput
                  id="url-input"
                  label="URL"
                  value={url}
                  onChange={handleUrlChange}
                  onKeyDown={handleKeyDown}
                  error={!!urlError}
                  multiline
                  minRows={3}
                  maxRows={6}
                  placeholder="https://grafana.example.com/d/dashboard-id?from={perfana-start-epoch-milliseconds}&to={perfana-end-epoch-milliseconds}"
                />
                <FormHelperText error={!!urlError}>
                  {urlError ||
                    'Enter the URL template. Type "{" to see available variables. Use \u2191\u2193 to navigate, Enter to select, Esc to close.'}
                </FormHelperText>
              </FormControl>

              {/* Autocomplete Dropdown */}
              <AutocompletePopper
                open={autocompleteOpen}
                anchorEl={autocompleteAnchor}
                variables={filteredVariables}
                selectedIndex={selectedIndex}
                hoveredIndex={hoveredIndex}
                onSelect={handleVariableSelect}
                onHover={setHoveredIndex}
                menuListRef={menuListRef}
              />
            </Box>
          </ClickAwayListener>

          {/* Variable Helper */}
          <VariablesAccordion
            availableVariables={availableVariables}
            loadingConfigKeys={loadingConfigKeys}
            onInsertVariable={insertVariable}
          />

          {/* Tags */}
          <Box sx={{ mt: 2 }}>
            <TagsInput value={tags} onChange={setTags} />
          </Box>
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={submitting || loading || !name.trim() || !url.trim()}
          startIcon={submitting ? <CircularProgress size={16} /> : null}
        >
          {submitting ? 'Creating...' : 'Create Deep Link'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// Re-export types for consumers
export type { AddDeepLinkDialogProps } from './types';
