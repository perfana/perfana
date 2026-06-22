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
  Checkbox,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
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
  onSearchInputChange: (value: string) => void;
  onFetchEntities: (entityType: string) => void;

  // HOST multi-select via tag filter
  selectedTagKey: string;
  onTagKeyChange: (key: string) => void;
  selectedTagValue: string;
  onTagValueChange: (value: string) => void;
  selectedHosts: DynatraceEntity[];
  onSelectedHostsChange: (hosts: DynatraceEntity[]) => void;
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
  onSearchInputChange,
  onFetchEntities,
  selectedTagKey,
  onTagKeyChange,
  selectedTagValue,
  onTagValueChange,
  selectedHosts,
  onSelectedHostsChange,
}: AddEntityDialogProps) {
  const isHost = selectedEntityType === 'HOST';

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

  // Only HOST entities feed the multi-select list, even if `entities` still holds
  // a stale mixed-type fetch from before the type was switched to HOST.
  const hostEntities = entities.filter((e) => e.entityType === 'HOST');

  // Tag options derived from the fetched hosts. ponytail: client-side over the
  // fetched page (≤500 hosts); push tag("k:v") into the server entitySelector if
  // a fleet ever exceeds one page.
  const tagKeys = Array.from(
    new Set(hostEntities.flatMap((e) => (e.tags || []).map((t) => t.key)))
  ).sort();
  const tagValues = Array.from(
    new Set(
      hostEntities
        .flatMap((e) => e.tags || [])
        .filter((t) => t.key === selectedTagKey && t.value)
        .map((t) => t.value as string)
    )
  ).sort();

  const nameQuery = searchInput.trim().toLowerCase();
  const filteredHosts = hostEntities.filter((e) => {
    if (nameQuery && !e.displayName.toLowerCase().includes(nameQuery)) return false;
    if (!selectedTagKey) return true;
    return (e.tags || []).some(
      (t) => t.key === selectedTagKey && (!selectedTagValue || t.value === selectedTagValue)
    );
  });

  const isSelected = (entityId: string) => selectedHosts.some((h) => h.entityId === entityId);

  const toggleHost = (host: DynatraceEntity) => {
    onSelectedHostsChange(
      isSelected(host.entityId)
        ? selectedHosts.filter((h) => h.entityId !== host.entityId)
        : [...selectedHosts, host]
    );
  };

  const selectedFilteredCount = filteredHosts.filter((h) => isSelected(h.entityId)).length;
  const allFilteredSelected = filteredHosts.length > 0 && selectedFilteredCount === filteredHosts.length;

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      const filteredIds = new Set(filteredHosts.map((h) => h.entityId));
      onSelectedHostsChange(selectedHosts.filter((h) => !filteredIds.has(h.entityId)));
    } else {
      const selectedIds = new Set(selectedHosts.map((h) => h.entityId));
      const additions = filteredHosts.filter((h) => !selectedIds.has(h.entityId));
      onSelectedHostsChange([...selectedHosts, ...additions]);
    }
  };

  const submitDisabled = loading || (isHost ? selectedHosts.length === 0 : !selectedEntity);
  const submitLabel = loading
    ? 'Adding...'
    : isHost
    ? `Add ${selectedHosts.length} ${selectedHosts.length === 1 ? 'Host' : 'Hosts'}`
    : 'Add Entity';

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

          {isHost ? (
            <>
              <TextField
                label="Search hosts by name"
                placeholder="Type to filter..."
                value={searchInput}
                onChange={(e) => onSearchInputChange(e.target.value)}
                disabled={entitiesLoading && hostEntities.length === 0}
                helperText="Optional — filters the host list below"
                InputProps={{
                  endAdornment: entitiesLoading ? (
                    <CircularProgress color="inherit" size={20} />
                  ) : null,
                }}
                fullWidth
              />

              <Box sx={{ display: 'flex', gap: 2 }}>
                <FormControl fullWidth>
                  <InputLabel>Tag</InputLabel>
                  <Select
                    value={tagKeys.includes(selectedTagKey) ? selectedTagKey : ''}
                    onChange={(e: SelectChangeEvent) => onTagKeyChange(e.target.value)}
                    label="Tag"
                    disabled={tagKeys.length === 0}
                  >
                    <MenuItem value="">
                      <em>Any tag</em>
                    </MenuItem>
                    {tagKeys.map((key) => (
                      <MenuItem key={key} value={key}>
                        {key}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <FormControl fullWidth>
                  <InputLabel>Value</InputLabel>
                  <Select
                    value={tagValues.includes(selectedTagValue) ? selectedTagValue : ''}
                    onChange={(e: SelectChangeEvent) => onTagValueChange(e.target.value)}
                    label="Value"
                    disabled={!selectedTagKey || tagValues.length === 0}
                  >
                    <MenuItem value="">
                      <em>Any value</em>
                    </MenuItem>
                    {tagValues.map((value) => (
                      <MenuItem key={value} value={value}>
                        {value}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>

              <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
                <ListItemButton onClick={toggleSelectAll} disabled={filteredHosts.length === 0}>
                  <ListItemIcon sx={{ minWidth: 'auto', mr: 1 }}>
                    <Checkbox
                      edge="start"
                      checked={allFilteredSelected}
                      indeterminate={!allFilteredSelected && selectedFilteredCount > 0}
                      tabIndex={-1}
                      disableRipple
                    />
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      filteredHosts.length === 0
                        ? entitiesLoading
                          ? 'Loading hosts...'
                          : 'No matching hosts'
                        : `Select all (${filteredHosts.length})`
                    }
                    secondary={
                      selectedHosts.length > 0 ? `${selectedHosts.length} selected` : undefined
                    }
                  />
                </ListItemButton>
                <List dense sx={{ maxHeight: 240, overflow: 'auto', pt: 0 }}>
                  {filteredHosts.map((host) => (
                    <ListItem key={host.entityId} disablePadding>
                      <ListItemButton onClick={() => toggleHost(host)}>
                        <ListItemIcon sx={{ minWidth: 'auto', mr: 1 }}>
                          <Checkbox
                            edge="start"
                            checked={isSelected(host.entityId)}
                            tabIndex={-1}
                            disableRipple
                          />
                        </ListItemIcon>
                        <ListItemText
                          primary={host.displayName}
                          secondary={host.entityId}
                          primaryTypographyProps={{ variant: 'body2' }}
                          secondaryTypographyProps={{ variant: 'caption' }}
                        />
                      </ListItemButton>
                    </ListItem>
                  ))}
                </List>
              </Box>
            </>
          ) : (
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
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          onClick={onSubmit}
          variant="contained"
          disabled={submitDisabled}
          startIcon={loading ? <CircularProgress size={16} /> : <SaveIcon />}
        >
          {submitLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
