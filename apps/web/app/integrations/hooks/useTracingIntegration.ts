'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  fetchTracingInstances,
  createTracingInstance,
  updateTracingInstance,
  deleteTracingInstance,
  testTracingConnectionWithParams,
  TracingInstance,
} from '@/lib/distributed-tracing';
import {
  createTracingInstanceSchema,
  type CreateTracingInstanceFormData,
} from '@/lib/validations';
import { SnackbarState } from '../types';

interface UseTracingIntegrationProps {
  onSnackbar: (state: SnackbarState) => void;
  organizationId?: string | null;
}

export function useTracingIntegration({ onSnackbar, organizationId }: UseTracingIntegrationProps) {
  const [instances, setInstances] = useState<TracingInstance[]>([]);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedInstance, setSelectedInstance] = useState<TracingInstance | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);

  const form = useForm<CreateTracingInstanceFormData>({
    resolver: zodResolver(createTracingInstanceSchema),
    defaultValues: {
      label: '',
      tracingUrl: '',
      tracingApiUrl: '',
      tracingUi: 'tempo',
      tracingIframeAllowed: false,
      useProxy: false,
    },
  });

  // Populate form when editing
  useEffect(() => {
    if (editDialogOpen && selectedInstance) {
      form.reset({
        label: selectedInstance.label,
        tracingUrl: selectedInstance.tracing_url,
        tracingApiUrl: selectedInstance.tracing_api_url || '',
        tracingUi: selectedInstance.tracing_ui,
        tracingIframeAllowed: selectedInstance.tracing_iframe_allowed,
        useProxy: selectedInstance.use_proxy ?? false,
      });
    }
  }, [editDialogOpen, selectedInstance, form]);

  const loadInstances = async () => {
    try {
      const loadedInstances = await fetchTracingInstances(organizationId);
      setInstances(loadedInstances);
    } catch (err) {
      console.error('Failed to load Tracing instances:', err);
    }
  };

  const handleCreate = async (data: CreateTracingInstanceFormData) => {
    try {
      const instance = await createTracingInstance({
        label: data.label!,
        tracingUrl: data.tracingUrl!,
        tracingApiUrl: data.tracingApiUrl,
        tracingUi: data.tracingUi!,
        tracingIframeAllowed: data.tracingIframeAllowed!,
        useProxy: data.useProxy,
        ...(organizationId && { organizationId }),
      });
      setInstances([instance, ...instances]);
      setCreateDialogOpen(false);
      form.reset();
      onSnackbar({
        open: true,
        message: 'Tracing instance created successfully',
        severity: 'success',
      });
    } catch (err) {
      form.setError('root', {
        message: err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to create Tracing instance',
      });
    }
  };

  const handleUpdate = async (data: CreateTracingInstanceFormData) => {
    if (!selectedInstance) return;

    try {
      const instance = await updateTracingInstance(selectedInstance.id, {
        label: data.label!,
        tracingUrl: data.tracingUrl!,
        tracingApiUrl: data.tracingApiUrl,
        tracingUi: data.tracingUi!,
        tracingIframeAllowed: data.tracingIframeAllowed!,
        useProxy: data.useProxy,
      });
      setInstances(instances.map(t => t.id === instance.id ? instance : t));
      setEditDialogOpen(false);
      setSelectedInstance(null);
      form.reset();
      onSnackbar({
        open: true,
        message: 'Tracing instance updated successfully',
        severity: 'success',
      });
    } catch (err) {
      form.setError('root', {
        message: err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to update Tracing instance',
      });
    }
  };

  const handleDelete = async (instanceId: string) => {
    try {
      await deleteTracingInstance(instanceId);
      setInstances(instances.filter(t => t.id !== instanceId));
      setDeleteDialogOpen(false);
      setSelectedInstance(null);
      onSnackbar({
        open: true,
        message: 'Tracing instance deleted successfully',
        severity: 'success',
      });
    } catch (err) {
      onSnackbar({
        open: true,
        message: err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to delete Tracing instance',
        severity: 'error',
      });
    }
  };

  const handleTestConnection = async (data: CreateTracingInstanceFormData) => {
    try {
      setTestingConnection(true);
      const result = await testTracingConnectionWithParams({
        tracingUrl: data.tracingUrl!,
        tracingUi: data.tracingUi!,
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

  const openEditDialog = (instance: TracingInstance) => {
    setSelectedInstance(instance);
    setEditDialogOpen(true);
  };

  const openDeleteDialog = (instance: TracingInstance) => {
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
