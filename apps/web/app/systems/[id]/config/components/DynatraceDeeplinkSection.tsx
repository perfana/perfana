'use client';

import {
  Box,
  Typography,
  Button,
  Alert,
  CircularProgress,
} from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';

// Types
import { DynatraceDeeplinkSectionProps } from './dynatrace-deeplinks/types';

// Hooks
import { useDynatraceEntityMappings } from './dynatrace-deeplinks/hooks';

// Components
import { EntityMappingsTable, AddEntityDialog } from './dynatrace-deeplinks/components';

export default function DynatraceDeeplinkSection({
  systemId,
  _systemName,
  selectedEnvironment,
  selectedWorkload,
}: DynatraceDeeplinkSectionProps) {
  const {
    // Dynatrace instances
    dynatraceInstances,
    selectedInstance,
    setSelectedInstance,

    // Entity mappings
    filteredMappings,
    loading,
    error,

    // Entities for autocomplete
    entities,
    entitiesLoading,

    // Dialog state
    addDialogOpen,
    addLoading,

    // Form state
    selectedLevel,
    setSelectedLevel,
    selectedEntityType,
    setSelectedEntityType,
    selectedEntity,
    setSelectedEntity,
    searchInput,

    // Actions
    fetchDynatraceEntities,
    handleAddEntity,
    handleSubmitEntity,
    handleDeleteEntity,
    handleInputChange,
    resetDialogState,
  } = useDynatraceEntityMappings({
    systemId,
    selectedEnvironment,
    selectedWorkload,
  });

  const handleInstanceChange = (instanceId: string) => {
    setSelectedInstance(instanceId);
    setSelectedEntity(null);
  };

  const handleEntityTypeChange = (type: string) => {
    setSelectedEntityType(type);
    setSelectedEntity(null);
  };

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h6" gutterBottom>
            Dynatrace Entities
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Configure Dynatrace entities at different levels
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={handleAddEntity}
          disabled={loading}
        >
          Add Entity
        </Button>
      </Box>

      {/* Error Alert */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Content */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      ) : filteredMappings.length === 0 ? (
        <Alert severity="info">
          No Dynatrace entities configured for the current context.
        </Alert>
      ) : (
        <EntityMappingsTable
          mappings={filteredMappings}
          onDelete={handleDeleteEntity}
        />
      )}

      {/* Footer Help Text */}
      <Box sx={{ mt: 2 }}>
        <Typography variant="caption" color="text.secondary">
          Entity mappings enable Perfana to create deeplinks to specific Dynatrace entities based on your system configuration hierarchy.
        </Typography>
      </Box>

      {/* Add Entity Dialog */}
      <AddEntityDialog
        open={addDialogOpen}
        onClose={resetDialogState}
        onSubmit={handleSubmitEntity}
        loading={addLoading}
        dynatraceInstances={dynatraceInstances}
        selectedInstance={selectedInstance}
        onInstanceChange={handleInstanceChange}
        selectedLevel={selectedLevel}
        onLevelChange={setSelectedLevel}
        selectedEntityType={selectedEntityType}
        onEntityTypeChange={handleEntityTypeChange}
        entities={entities}
        entitiesLoading={entitiesLoading}
        selectedEntity={selectedEntity}
        onEntityChange={setSelectedEntity}
        searchInput={searchInput}
        onInputChange={handleInputChange}
        onFetchEntities={fetchDynatraceEntities}
      />
    </Box>
  );
}
