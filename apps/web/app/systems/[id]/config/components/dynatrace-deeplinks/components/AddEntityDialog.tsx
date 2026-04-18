'use client';

import {
  Box,
  Typography,
  Button,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormHelperText,
  SelectChangeEvent,
  Autocomplete,
  CircularProgress,
} from '@mui/material';
import { Save as SaveIcon } from '@mui/icons-material';
import {
  DynatraceConfig,
  DynatraceEntity,
  EntityMappingLevel,
} from '../types';
import { ENTITY_TYPES } from '../utils';

interface AddEntityDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: () => void;
  loading: boolean;

  // Instance selection
  dynatraceInstances: DynatraceConfig[];
  selectedInstance: string;
  onInstanceChange: (instanceId: string) => void;

  // Level selection
  selectedLevel: EntityMappingLevel;
  onLevelChange: (level: EntityMappingLevel) => void;

  // Entity type selection
  selectedEntityType: string;
  onEntityTypeChange: (type: string) => void;

  // Entity selection
  entities: DynatraceEntity[];
  entitiesLoading: boolean;
  selectedEntity: DynatraceEntity | null;
  onEntityChange: (entity: DynatraceEntity | null) => void;
  searchInput: string;
  onInputChange: (event: unknown, newInputValue: string, reason?: string) => void;
  onFetchEntities: (entityType: string) => void;
}

export function AddEntityDialog({
  open,
  onClose,
  onSubmit,
  loading,
  dynatraceInstances,
  selectedInstance,
  onInstanceChange,
  selectedLevel,
  onLevelChange,
  selectedEntityType,
  onEntityTypeChange,
  entities,
  entitiesLoading,
  selectedEntity,
  onEntityChange,
  searchInput,
  onInputChange,
  onFetchEntities,
}: AddEntityDialogProps) {
  const handleInstanceChange = (e: SelectChangeEvent) => {
    onInstanceChange(e.target.value);
    onEntityChange(null);
  };

  const handleLevelChange = (e: SelectChangeEvent) => {
    onLevelChange(e.target.value as EntityMappingLevel);
  };

  const handleEntityTypeChange = (e: SelectChangeEvent) => {
    const newType = e.target.value;
    onEntityTypeChange(newType);
    onEntityChange(null);

    // HOST entities require workload level for metric query creation
    if (newType === 'HOST') {
      onLevelChange('sut_testenv_workload');
    }

    if (newType) {
      onFetchEntities(newType);
    }
  };

  const handleEntityChange = (_: unknown, newValue: DynatraceEntity | null) => {
    onEntityChange(newValue);
    if (!newValue && selectedEntityType) {
      onFetchEntities(selectedEntityType);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add Dynatrace Entity</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, pt: 1 }}>
          <FormControl fullWidth>
            <InputLabel>Dynatrace Instance</InputLabel>
            <Select
              value={selectedInstance}
              onChange={handleInstanceChange}
              label="Dynatrace Instance"
              disabled={dynatraceInstances.length === 0}
            >
              {dynatraceInstances.map((instance) => (
                <MenuItem key={instance.id} value={instance.id}>
                  {instance.label}
                </MenuItem>
              ))}
            </Select>
            <FormHelperText>
              {dynatraceInstances.length === 0
                ? 'No Dynatrace instances configured. Please configure an instance first.'
                : 'Select which Dynatrace instance to fetch entities from'}
            </FormHelperText>
          </FormControl>

          <FormControl fullWidth>
            <InputLabel>Configuration Scope</InputLabel>
            <Select
              value={selectedLevel}
              onChange={handleLevelChange}
              label="Configuration Scope"
              disabled={selectedEntityType === 'HOST'}
            >
              <MenuItem value="sut">System under test</MenuItem>
              <MenuItem value="sut_testenv">Test environment</MenuItem>
              <MenuItem value="sut_testenv_workload">Workload</MenuItem>
            </Select>
            <FormHelperText>
              {selectedEntityType === 'HOST'
                ? 'HOST entities require workload scope for metric query creation'
                : 'Choose at which scope this entity should be available'}
            </FormHelperText>
          </FormControl>

          <FormControl fullWidth>
            <InputLabel>Entity Type</InputLabel>
            <Select
              value={selectedEntityType}
              onChange={handleEntityTypeChange}
              label="Entity Type"
              disabled={!selectedInstance}
            >
              {ENTITY_TYPES.map((type) => (
                <MenuItem key={type.value} value={type.value}>
                  {type.label}
                </MenuItem>
              ))}
            </Select>
            <FormHelperText>
              {!selectedInstance
                ? 'Please select a Dynatrace instance first'
                : 'Choose the type of Dynatrace entity you want to configure'}
            </FormHelperText>
          </FormControl>

          <Autocomplete
            options={entities}
            getOptionLabel={(option) => option.displayName}
            value={selectedEntity}
            inputValue={searchInput}
            open={entities.length > 0 && searchInput.length >= 2 && !selectedEntity}
            onChange={handleEntityChange}
            onInputChange={onInputChange}
            disabled={!selectedEntityType || entitiesLoading}
            loading={entitiesLoading}
            filterOptions={(options) => options}
            openOnFocus={false}
            clearOnBlur={false}
            selectOnFocus={true}
            handleHomeEndKeys={true}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Dynatrace Entity"
                placeholder="Type to search..."
                helperText={
                  !selectedEntityType
                    ? 'Please select an entity type first'
                    : entitiesLoading
                    ? 'Loading entities...'
                    : 'Type at least 2 characters to search for specific entities'
                }
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {entitiesLoading ? <CircularProgress color="inherit" size={20} /> : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
              />
            )}
            renderOption={(props, option) => {
              const { _key, ...otherProps } = props;
              return (
                <Box component="li" key={option.entityId} {...otherProps}>
                  <Box>
                    <Typography variant="body2">{option.displayName}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {option.entityType} - {option.entityId}
                    </Typography>
                  </Box>
                </Box>
              );
            }}
            fullWidth
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          onClick={onSubmit}
          variant="contained"
          disabled={!selectedEntity || loading}
          startIcon={loading ? <CircularProgress size={16} /> : <SaveIcon />}
        >
          {loading ? 'Adding...' : 'Add Entity'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
