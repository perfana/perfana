'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  fetchPyroscopeInstances,
  createPyroscopeInstance,
  updatePyroscopeInstance,
  deletePyroscopeInstance,
  testPyroscopeConnectionWithParams,
  PyroscopeInstance,
} from '@/lib/pyroscope';
import {
  createPyroscopeInstanceSchema,
  type CreatePyroscopeInstanceFormData,
} from '@/lib/validations';
import { SnackbarState } from '../types';

interface UsePyroscopeIntegrationProps {
  onSnackbar: (state: SnackbarState) => void;
  organizationId?: string | null;
}

export function usePyroscopeIntegration({ onSnackbar, organizationId }: UsePyroscopeIntegrationProps) {
  const [instances, setInstances] = useState<PyroscopeInstance[]>([]);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedInstance, setSelectedInstance] = useState<PyroscopeInstance | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);

  const form = useForm<CreatePyroscopeInstanceFormData>({
    resolver: zodResolver(createPyroscopeInstanceSchema),
    defaultValues: {
      label: '',
      pyroscopeUrl: '',
      backendUrl: '',
      pyroscopeStandAlone: false,
    },
  });

  // Populate form when editing
  useEffect(() => {
    if (editDialogOpen && selectedInstance) {
      form.reset({
        label: selectedInstance.label,
        pyroscopeUrl: selectedInstance.pyroscopeUrl,
        backendUrl: selectedInstance.backendUrl || '',
        pyroscopeStandAlone: selectedInstance.pyroscopeStandAlone,
      });
    }
  }, [editDialogOpen, selectedInstance, form]);

  const loadInstances = async () => {
    try {
      const loadedInstances = await fetchPyroscopeInstances(undefined, organizationId);
      setInstances(loadedInstances);
    } catch (err) {
      console.error('Failed to load Pyroscope instances:', err);
    }
  };

  // Auto-refetch when organizationId changes
  useEffect(() => {
    if (organizationId) {
      loadInstances();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  const handleCreate = async (data: CreatePyroscopeInstanceFormData) => {
    try {
      const instance = await createPyroscopeInstance({
        label: data.label!,
        pyroscopeUrl: data.pyroscopeUrl!,
        pyroscopeStandAlone: data.pyroscopeStandAlone,
        ...(organizationId && { organizationId }),
      });
      setInstances([instance, ...instances]);
      setCreateDialogOpen(false);
      form.reset();
      onSnackbar({
        open: true,
        message: 'Pyroscope instance created successfully',
        severity: 'success',
      });
    } catch (err) {
      form.setError('root', {
        message: err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to create Pyroscope instance',
      });
    }
  };

  const handleUpdate = async (data: CreatePyroscopeInstanceFormData) => {
    if (!selectedInstance) return;

    try {
      const instance = await updatePyroscopeInstance(selectedInstance.id, data);
      setInstances(instances.map(p => p.id === instance.id ? instance : p));
      setEditDialogOpen(false);
      setSelectedInstance(null);
      form.reset();
      onSnackbar({
        open: true,
        message: 'Pyroscope instance updated successfully',
        severity: 'success',
      });
    } catch (err) {
      form.setError('root', {
        message: err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to update Pyroscope instance',
      });
    }
  };

  const handleDelete = async (instanceId: string) => {
    try {
      await deletePyroscopeInstance(instanceId);
      setInstances(instances.filter(p => p.id !== instanceId));
      setDeleteDialogOpen(false);
      setSelectedInstance(null);
      onSnackbar({
        open: true,
        message: 'Pyroscope instance deleted successfully',
        severity: 'success',
      });
    } catch (err) {
      onSnackbar({
        open: true,
        message: err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to delete Pyroscope instance',
        severity: 'error',
      });
    }
  };

  const handleTestConnection = async (data: CreatePyroscopeInstanceFormData) => {
    try {
      setTestingConnection(true);
      const result = await testPyroscopeConnectionWithParams({
        pyroscopeUrl: data.pyroscopeUrl,
      });
      onSnackbar({
        open: true,
        message: result.message || 'Connection successful!',
        severity: 'success',
      });
    } catch (err) {
      onSnackbar({
        open: true,
        message: err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Connection test failed',
        severity: 'error',
      });
    } finally {
      setTestingConnection(false);
    }
  };

  const openEditDialog = (instance: PyroscopeInstance) => {
    setSelectedInstance(instance);
    setEditDialogOpen(true);
  };

  const openDeleteDialog = (instance: PyroscopeInstance) => {
    setSelectedInstance(instance);
    setDeleteDialogOpen(true);
  };

  const closeDialogs = () => {
    setCreateDialogOpen(false);
    setEditDialogOpen(false);
    setDeleteDialogOpen(false);
    setSelectedInstance(null);
    form.reset();
  };

  return {
    instances,
    form,
    createDialogOpen,
    setCreateDialogOpen,
    editDialogOpen,
    setEditDialogOpen,
    deleteDialogOpen,
    setDeleteDialogOpen,
    selectedInstance,
    testingConnection,
    loadInstances,
    handleCreate,
    handleUpdate,
    handleDelete,
    handleTestConnection,
    openEditDialog,
    openDeleteDialog,
    closeDialogs,
  };
}
