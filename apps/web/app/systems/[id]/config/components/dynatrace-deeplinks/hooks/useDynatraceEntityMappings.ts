'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { authenticatedFetch } from '@/lib/api';
import {
  DynatraceConfig,
  DynatraceEntity,
  DynatraceEntityMapping,
  EntityMappingLevel,
} from '../types';
import { filterMappingsByContext } from '../utils';

interface UseDynatraceEntityMappingsProps {
  systemId: string;
  selectedEnvironment: string;
  selectedWorkload: string;
}

interface UseDynatraceEntityMappingsReturn {
  // Dynatrace instances
  dynatraceInstances: DynatraceConfig[];
  selectedInstance: string;
  setSelectedInstance: (id: string) => void;

  // Entity mappings
  entityMappings: DynatraceEntityMapping[];
  filteredMappings: DynatraceEntityMapping[];
  loading: boolean;
  error: string | null;
  setError: (error: string | null) => void;

  // Entities for autocomplete
  entities: DynatraceEntity[];
  entitiesLoading: boolean;

  // Dialog state
  addDialogOpen: boolean;
  setAddDialogOpen: (open: boolean) => void;
  addLoading: boolean;

  // Form state
  selectedLevel: EntityMappingLevel;
  setSelectedLevel: (level: EntityMappingLevel) => void;
  selectedEntityType: string;
  setSelectedEntityType: (type: string) => void;
  selectedEntity: DynatraceEntity | null;
  setSelectedEntity: (entity: DynatraceEntity | null) => void;
  searchInput: string;
  setSearchInput: (input: string) => void;

  // Refs for input handling
  userTypingRef: React.MutableRefObject<boolean>;
  lastValidInputRef: React.MutableRefObject<string>;
  inputChangeTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>;

  // Actions
  fetchDynatraceEntities: (entityType?: string, entityName?: string) => Promise<void>;
  handleAddEntity: () => Promise<void>;
  handleSubmitEntity: () => Promise<void>;
  handleDeleteEntity: (mapping: DynatraceEntityMapping) => Promise<void>;
  handleInputChange: (event: unknown, newInputValue: string, reason?: string) => void;
  resetDialogState: () => void;
}

export function useDynatraceEntityMappings({
  systemId,
  selectedEnvironment,
  selectedWorkload,
}: UseDynatraceEntityMappingsProps): UseDynatraceEntityMappingsReturn {
  // Dynatrace instances state
  const [dynatraceInstances, setDynatraceInstances] = useState<DynatraceConfig[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<string>('');

  // Entity mappings state
  const [entityMappings, setEntityMappings] = useState<DynatraceEntityMapping[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Entities for autocomplete
  const [entities, setEntities] = useState<DynatraceEntity[]>([]);
  const [entitiesLoading, setEntitiesLoading] = useState(false);

  // Dialog state
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addLoading, setAddLoading] = useState(false);

  // Form state
  const [selectedLevel, setSelectedLevel] = useState<EntityMappingLevel>('sut');
  const [selectedEntityType, setSelectedEntityType] = useState<string>('');
  const [selectedEntity, setSelectedEntity] = useState<DynatraceEntity | null>(null);
  const [searchInput, setSearchInput] = useState<string>('');

  // Refs for input handling
  const inputChangeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const userTypingRef = useRef<boolean>(false);
  const lastValidInputRef = useRef<string>('');

  // Fetch Dynatrace instances on mount
  useEffect(() => {
    fetchDynatraceInstances();
  }, []);

  // Fetch entity mappings for the current context
  useEffect(() => {
    fetchEntityMappings();
  }, [systemId, selectedEnvironment, selectedWorkload]);

  // Debounced search effect
  useEffect(() => {
    if (!selectedEntityType) {
      return;
    }

    const timeoutId = setTimeout(() => {
      if (searchInput.trim().length >= 2) {
        fetchDynatraceEntities(selectedEntityType, searchInput.trim());
      } else if (searchInput.trim().length === 0 && !selectedEntity) {
        fetchDynatraceEntities(selectedEntityType);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [selectedEntityType, searchInput, selectedEntity]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (inputChangeTimeoutRef.current) {
        clearTimeout(inputChangeTimeoutRef.current);
      }
    };
  }, []);

  const fetchDynatraceInstances = async () => {
    try {
      const response = await authenticatedFetch('/dynatrace', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch Dynatrace instances');
      }

      const data = await response.json();
      setDynatraceInstances(data || []);

      if (data && data.length > 0) {
        setSelectedInstance(data[0].id);
      }
    } catch (err) {
      setError(err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Failed to fetch Dynatrace instances');
    }
  };

  const fetchEntityMappings = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await authenticatedFetch(
        `/dynatrace/entities/mappings?systemId=${systemId}&environment=${selectedEnvironment}&workload=${selectedWorkload}`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch entity mappings');
      }

      const data = await response.json();
      setEntityMappings(data || []);
    } catch (err) {
      setError(err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Failed to fetch entity mappings');
      setEntityMappings([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchDynatraceEntities = useCallback(async (entityType?: string, entityName?: string) => {
    try {
      setEntitiesLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (entityType) params.append('entityType', entityType);
      if (entityName) params.append('entityName', entityName);
      if (selectedInstance) params.append('dynatraceConfigId', selectedInstance);

      const response = await authenticatedFetch(`/dynatrace/entities?${params.toString()}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch Dynatrace entities');
      }

      const data = await response.json();
      const rawEntities = data.entities || [];

      const transformedEntities: DynatraceEntity[] = rawEntities.map((entity: Record<string, unknown>) => ({
        entityId: entity.entityId as string,
        displayName: entity.displayName as string,
        entityType: entity.type as string,
        tags: (entity.tags as Array<{ key: string; value?: string }>) || [],
      }));

      setEntities(transformedEntities);
    } catch (err) {
      setError(err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Failed to fetch Dynatrace entities');
      setEntities([]);
    } finally {
      setEntitiesLoading(false);
    }
  }, [selectedInstance]);

  const handleInputChange = useCallback((event: unknown, newInputValue: string, reason?: string) => {
    if (reason === 'reset') {
      return;
    }

    if (inputChangeTimeoutRef.current) {
      clearTimeout(inputChangeTimeoutRef.current);
    }

    const typedEvent = event as { type?: string } | null;
    const isUserInput = typedEvent && (typedEvent.type === 'input' || typedEvent.type === 'change');

    if (isUserInput && newInputValue.length > 0) {
      userTypingRef.current = true;
      lastValidInputRef.current = newInputValue;
    }

    if (newInputValue === '' && userTypingRef.current && lastValidInputRef.current.length > 0) {
      return;
    }

    if (newInputValue.length > 0 || !userTypingRef.current) {
      inputChangeTimeoutRef.current = setTimeout(() => {
        setSearchInput(newInputValue);

        if (newInputValue === '') {
          userTypingRef.current = false;
          lastValidInputRef.current = '';
        }
      }, 0);
    }
  }, []);

  const resetDialogState = useCallback(() => {
    setAddDialogOpen(false);
    setSelectedEntity(null);
    setSelectedEntityType('');
    setSelectedLevel('sut');
    setSearchInput('');
    userTypingRef.current = false;
    lastValidInputRef.current = '';
  }, []);

  const handleAddEntity = async () => {
    if (entities.length === 0) {
      await fetchDynatraceEntities();
    }
    setAddDialogOpen(true);
  };

  const handleSubmitEntity = async () => {
    if (!selectedEntity || !selectedInstance) return;

    try {
      setAddLoading(true);
      setError(null);

      const payload = {
        dynatraceConfigId: selectedInstance,
        systemUnderTestId: systemId,
        testEnvironment: selectedLevel !== 'sut' ? selectedEnvironment : undefined,
        workload: selectedLevel === 'sut_testenv_workload' ? selectedWorkload : undefined,
        entityId: selectedEntity.entityId,
        entityDisplayName: selectedEntity.displayName,
        entityType: selectedEntity.entityType,
        level: selectedLevel,
      };

      const response = await authenticatedFetch('/dynatrace/entities/mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();

        if (response.status === 409) {
          setError('Entity already added');
          resetDialogState();
          return;
        }

        let errorMessage = `Failed to add entity mapping: ${response.status} ${response.statusText}`;
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.message) {
            errorMessage = errorJson.message;
          }
        } catch {
          // Use default error message
        }

        throw new Error(errorMessage);
      }

      await fetchEntityMappings();
      resetDialogState();
    } catch (err) {
      setError(err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Failed to add entity mapping');
    } finally {
      setAddLoading(false);
    }
  };

  const handleDeleteEntity = async (mapping: DynatraceEntityMapping) => {
    try {
      setError(null);

      const response = await authenticatedFetch(`/dynatrace/entities/mappings/${mapping.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error('Failed to delete entity mapping');
      }

      await fetchEntityMappings();
    } catch (err) {
      setError(err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Failed to delete entity mapping');
    }
  };

  const filteredMappings = filterMappingsByContext(
    entityMappings,
    selectedEnvironment,
    selectedWorkload
  ) as DynatraceEntityMapping[];

  return {
    // Dynatrace instances
    dynatraceInstances,
    selectedInstance,
    setSelectedInstance,

    // Entity mappings
    entityMappings,
    filteredMappings,
    loading,
    error,
    setError,

    // Entities for autocomplete
    entities,
    entitiesLoading,

    // Dialog state
    addDialogOpen,
    setAddDialogOpen,
    addLoading,

    // Form state
    selectedLevel,
    setSelectedLevel,
    selectedEntityType,
    setSelectedEntityType,
    selectedEntity,
    setSelectedEntity,
    searchInput,
    setSearchInput,

    // Refs
    userTypingRef,
    lastValidInputRef,
    inputChangeTimeoutRef,

    // Actions
    fetchDynatraceEntities,
    handleAddEntity,
    handleSubmitEntity,
    handleDeleteEntity,
    handleInputChange,
    resetDialogState,
  };
}
