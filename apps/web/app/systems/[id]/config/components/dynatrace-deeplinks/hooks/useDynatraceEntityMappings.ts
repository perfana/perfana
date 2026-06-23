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

// Prefer the API's JSON `message`, fall back to a status-based string for non-JSON bodies.
async function messageFromResponse(response: Response, fallback: string): Promise<string> {
  const text = await response.text();
  try {
    const json = JSON.parse(text);
    if (json && json.message) return json.message as string;
  } catch {
    // Non-JSON body — use the fallback.
  }
  return fallback;
}

interface UseDynatraceEntityMappingsProps {
  systemId: string;
  selectedEnvironment: string;
  selectedWorkload: string;
  // Adding a HOST mapping auto-creates metric queries server-side; the parent
  // uses this to refetch the Queries tab so they appear without a reload.
  onHostQueriesCreated?: () => void;
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

  // Multi-select + delete confirmation
  selectedMappingIds: Set<string>;
  handleSelectAll: () => void;
  handleSelectOne: (id: string) => void;
  handleClearSelection: () => void;
  deleteDialogOpen: boolean;
  deletingMapping: DynatraceEntityMapping | null;
  deleteLoading: boolean;
  closeDeleteDialog: () => void;
  handleConfirmDelete: () => Promise<void>;
  batchDeleteDialogOpen: boolean;
  handleBatchDeleteClick: () => void;
  handleBatchDeleteConfirm: () => Promise<void>;
  handleBatchDeleteCancel: () => void;

  // Form state
  selectedLevel: EntityMappingLevel;
  setSelectedLevel: (level: EntityMappingLevel) => void;
  selectedEntityType: string;
  setSelectedEntityType: (type: string) => void;
  selectedEntity: DynatraceEntity | null;
  setSelectedEntity: (entity: DynatraceEntity | null) => void;
  searchInput: string;
  setSearchInput: (input: string) => void;

  // HOST multi-select via tag filter
  selectedTagKey: string;
  setSelectedTagKey: (key: string) => void;
  selectedTagValue: string;
  setSelectedTagValue: (value: string) => void;
  selectedHosts: DynatraceEntity[];
  setSelectedHosts: (hosts: DynatraceEntity[]) => void;

  // Refs for input handling
  userTypingRef: React.MutableRefObject<boolean>;
  lastValidInputRef: React.MutableRefObject<string>;
  inputChangeTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>;

  // Actions
  fetchDynatraceEntities: (entityType?: string, entityName?: string) => Promise<void>;
  handleAddEntity: () => Promise<void>;
  handleSubmitEntity: () => Promise<void>;
  handleDeleteEntity: (mapping: DynatraceEntityMapping) => void;
  handleInputChange: (event: unknown, newInputValue: string, reason?: string) => void;
  resetDialogState: () => void;
}

export function useDynatraceEntityMappings({
  systemId,
  selectedEnvironment,
  selectedWorkload,
  onHostQueriesCreated,
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

  // Multi-select + delete confirmation state
  const [selectedMappingIds, setSelectedMappingIds] = useState<Set<string>>(new Set());
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingMapping, setDeletingMapping] = useState<DynatraceEntityMapping | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [batchDeleteDialogOpen, setBatchDeleteDialogOpen] = useState(false);

  // Form state
  const [selectedLevel, setSelectedLevel] = useState<EntityMappingLevel>('sut');
  const [selectedEntityType, setSelectedEntityType] = useState<string>('');
  const [selectedEntity, setSelectedEntity] = useState<DynatraceEntity | null>(null);
  const [searchInput, setSearchInput] = useState<string>('');

  // HOST multi-select via tag filter. Selected hosts are stored as full entity
  // objects (not ids) so the submit set never depends on the volatile `entities`
  // array — searching/filtering can replace `entities` without dropping a selection.
  const [selectedTagKey, setSelectedTagKey] = useState<string>('');
  const [selectedTagValue, setSelectedTagValue] = useState<string>('');
  const [selectedHosts, setSelectedHosts] = useState<DynatraceEntity[]>([]);

  // Refs for input handling
  const inputChangeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const userTypingRef = useRef<boolean>(false);
  const lastValidInputRef = useRef<string>('');
  // Synchronous guard against double-submit (setAddLoading is async).
  const submittingRef = useRef<boolean>(false);

  // Fetch Dynatrace instances on mount
  useEffect(() => {
    fetchDynatraceInstances();
  }, []);

  // Fetch entity mappings for the current context
  useEffect(() => {
    fetchEntityMappings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemId, selectedEnvironment, selectedWorkload]);

  // Debounced search effect.
  // HOST mode loads the full host list once (on entity-type change) and filters
  // client-side by tag + name in the dialog, so it does not refetch on keystrokes.
  useEffect(() => {
    if (!selectedEntityType || selectedEntityType === 'HOST') {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setSelectedTagKey('');
    setSelectedTagValue('');
    setSelectedHosts([]);
    userTypingRef.current = false;
    lastValidInputRef.current = '';
  }, []);

  const handleAddEntity = async () => {
    if (entities.length === 0) {
      await fetchDynatraceEntities();
    }
    setAddDialogOpen(true);
  };

  // Build the mapping payload for one entity using the current form context.
  const buildMappingPayload = (entity: DynatraceEntity) => ({
    dynatraceConfigId: selectedInstance,
    systemUnderTestId: systemId,
    testEnvironment: selectedLevel !== 'sut' ? selectedEnvironment : undefined,
    workload: selectedLevel === 'sut_testenv_workload' ? selectedWorkload : undefined,
    entityId: entity.entityId,
    entityDisplayName: entity.displayName,
    entityType: entity.entityType,
    level: selectedLevel,
  });

  const handleSubmitEntity = async () => {
    if (!selectedInstance) return;
    if (submittingRef.current) return; // guard against a double-click before addLoading propagates

    // HOST: add every checkbox-selected host. ponytail: loop the existing single
    // POST per host (handful of hosts in practice); add a bulk endpoint if fleets get large.
    if (selectedEntityType === 'HOST') {
      // Submit the stored selection objects directly — never re-derive from `entities`,
      // which the tag/name filter can have replaced.
      const hosts = selectedHosts;
      if (hosts.length === 0) return;

      submittingRef.current = true;
      try {
        setAddLoading(true);
        setError(null);

        let added = 0;
        let skipped = 0;
        const failed: DynatraceEntity[] = [];
        let firstError = '';
        // Per-host POSTs are not transactional; keep going on failure and report
        // a per-host summary rather than aborting mid-batch with a misleading message.
        for (const host of hosts) {
          const response = await authenticatedFetch('/dynatrace/entities/mappings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildMappingPayload(host)),
          });

          if (response.ok) {
            added++;
          } else if (response.status === 409) {
            skipped++; // already mapped — skip, don't abort the batch
          } else {
            failed.push(host);
            if (!firstError) {
              firstError = await messageFromResponse(response, `${response.status} ${response.statusText}`);
            }
          }
        }

        await fetchEntityMappings();

        // Each successful HOST add creates metric queries server-side — tell the
        // parent so the Queries tab refetches without a manual reload.
        if (added > 0) {
          onHostQueriesCreated?.();
        }

        if (failed.length > 0) {
          // Keep the dialog open with only the failures still selected so the user can retry.
          const failedIds = new Set(failed.map((h) => h.entityId));
          setSelectedHosts(hosts.filter((h) => failedIds.has(h.entityId)));
          const summary = [`added ${added}`, skipped ? `${skipped} already mapped` : '', `${failed.length} failed`]
            .filter(Boolean)
            .join(', ');
          setError(`${summary} (${failed.map((h) => h.displayName).join(', ')}): ${firstError}`);
        } else {
          resetDialogState();
          if (added === 0 && skipped > 0) {
            setError('All selected hosts were already added');
          }
        }
      } catch (err) {
        setError(err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Failed to add host mappings');
      } finally {
        setAddLoading(false);
        submittingRef.current = false;
      }
      return;
    }

    if (!selectedEntity) return;

    submittingRef.current = true;
    try {
      setAddLoading(true);
      setError(null);

      const response = await authenticatedFetch('/dynatrace/entities/mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildMappingPayload(selectedEntity)),
      });

      if (!response.ok) {
        if (response.status === 409) {
          setError('Entity already added');
          resetDialogState();
          return;
        }

        throw new Error(
          await messageFromResponse(
            response,
            `Failed to add entity mapping: ${response.status} ${response.statusText}`
          )
        );
      }

      await fetchEntityMappings();
      resetDialogState();
    } catch (err) {
      setError(err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Failed to add entity mapping');
    } finally {
      setAddLoading(false);
      submittingRef.current = false;
    }
  };

  const filteredMappings = filterMappingsByContext(
    entityMappings,
    selectedEnvironment,
    selectedWorkload
  ) as DynatraceEntityMapping[];

  // Single delete — open a confirmation dialog instead of deleting immediately.
  const handleDeleteEntity = (mapping: DynatraceEntityMapping) => {
    setError(null);
    setDeletingMapping(mapping);
    setDeleteDialogOpen(true);
  };

  const closeDeleteDialog = useCallback(() => {
    setError(null);
    setDeleteDialogOpen(false);
    setDeletingMapping(null);
  }, []);

  const handleConfirmDelete = async () => {
    if (!deletingMapping) return;
    try {
      setDeleteLoading(true);
      setError(null);

      const response = await authenticatedFetch(`/dynatrace/entities/mappings/${deletingMapping.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error('Failed to delete entity mapping');
      }

      await fetchEntityMappings();
      setDeleteDialogOpen(false);
      setDeletingMapping(null);
    } catch (err) {
      setError(err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Failed to delete entity mapping');
    } finally {
      setDeleteLoading(false);
    }
  };

  // Multi-select handlers (operate over the currently visible/filtered mappings)
  const handleSelectAll = () => {
    setSelectedMappingIds((prev) =>
      prev.size === filteredMappings.length
        ? new Set()
        : new Set(filteredMappings.map((m) => m.id))
    );
  };

  const handleSelectOne = useCallback((id: string) => {
    setSelectedMappingIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedMappingIds(new Set());
  }, []);

  // Batch delete
  const handleBatchDeleteClick = useCallback(() => {
    setError(null);
    setBatchDeleteDialogOpen(true);
  }, []);

  const handleBatchDeleteConfirm = async () => {
    const ids = Array.from(selectedMappingIds);
    try {
      setDeleteLoading(true);
      setError(null);

      const responses = await Promise.all(
        ids.map((id) =>
          authenticatedFetch(`/dynatrace/entities/mappings/${id}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
          })
        )
      );
      if (responses.some((r) => !r.ok)) {
        throw new Error('Failed to delete some entity mappings');
      }

      await fetchEntityMappings();
      setBatchDeleteDialogOpen(false);
      setSelectedMappingIds(new Set());
    } catch (err) {
      setError(err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Failed to delete some entity mappings');
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleBatchDeleteCancel = useCallback(() => {
    setError(null);
    setBatchDeleteDialogOpen(false);
  }, []);

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

    // Multi-select + delete confirmation
    selectedMappingIds,
    handleSelectAll,
    handleSelectOne,
    handleClearSelection,
    deleteDialogOpen,
    deletingMapping,
    deleteLoading,
    closeDeleteDialog,
    handleConfirmDelete,
    batchDeleteDialogOpen,
    handleBatchDeleteClick,
    handleBatchDeleteConfirm,
    handleBatchDeleteCancel,

    // Form state
    selectedLevel,
    setSelectedLevel,
    selectedEntityType,
    setSelectedEntityType,
    selectedEntity,
    setSelectedEntity,
    searchInput,
    setSearchInput,

    // HOST multi-select via tag filter
    selectedTagKey,
    setSelectedTagKey,
    selectedTagValue,
    setSelectedTagValue,
    selectedHosts,
    setSelectedHosts,

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
