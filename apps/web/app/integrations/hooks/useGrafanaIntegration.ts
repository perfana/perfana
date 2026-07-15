'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  fetchGrafanaInstances,
  createGrafanaInstance,
  updateGrafanaInstance,
  deleteGrafanaInstance,
  testGrafanaConnectionWithParams,
  GrafanaInstance,
} from '@/lib/grafana-instances';
import {
  createGrafanaInstanceSchema,
  type CreateGrafanaInstanceFormData,
} from '@/lib/validations';
import { SnackbarState } from '../types';

interface UseGrafanaIntegrationProps {
  onSnackbar: (state: SnackbarState) => void;
  organizationId?: string | null;
}

export function useGrafanaIntegration({ onSnackbar, organizationId }: UseGrafanaIntegrationProps) {
  const [instances, setInstances] = useState<GrafanaInstance[]>([]);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedInstance, setSelectedInstance] = useState<GrafanaInstance | null>(null);
  const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(new Set());
  const [testingConnection, setTestingConnection] = useState(false);

  const form = useForm<CreateGrafanaInstanceFormData>({
    resolver: zodResolver(createGrafanaInstanceSchema),
    defaultValues: {
      label: '',
      clientUrl: '',
      serverUrl: '',
      orgId: '1',
      apiKey: '',
      username: '',
      password: '',
      snapshotInstance: false,
      useProxy: false,
    },
  });

  // Populate form when editing
  useEffect(() => {
    if (editDialogOpen && selectedInstance) {
      form.reset({
        label: selectedInstance.label,
        clientUrl: selectedInstance.clientUrl,
        serverUrl: selectedInstance.serverUrl || '',
        orgId: selectedInstance.orgId,
        apiKey: '', // Don't pre-fill secrets — API returns '[MASKED]'; blank means "keep existing"
        username: selectedInstance.username || '',
        password: '', // Don't pre-fill password for security
        snapshotInstance: selectedInstance.snapshotInstance,
        useProxy: selectedInstance.useProxy,
      });
    }
  }, [editDialogOpen, selectedInstance, form]);

  const loadInstances = async () => {
    try {
      const loadedInstances = await fetchGrafanaInstances(undefined, organizationId);
      setInstances(loadedInstances);
    } catch (err) {
      console.error('Failed to load Grafana instances:', err);
    }
  };

  const handleCreate = async (data: CreateGrafanaInstanceFormData) => {
    try {
      const instance = await createGrafanaInstance({
        label: data.label!,
        clientUrl: data.clientUrl!,
        serverUrl: data.serverUrl,
        orgId: data.orgId!,
        apiKey: data.apiKey,
        username: data.username,
        password: data.password,
        snapshotInstance: data.snapshotInstance,
        useProxy: data.useProxy,
        ...(organizationId && { organizationId }),
      });
      setInstances([instance, ...instances]);
      setCreateDialogOpen(false);
      form.reset();
      onSnackbar({
        open: true,
        message: 'Grafana instance created successfully',
        severity: 'success',
      });
    } catch (err) {
      form.setError('root', {
        message: err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to create Grafana instance',
      });
    }
  };

  const handleUpdate = async (data: CreateGrafanaInstanceFormData) => {
    if (!selectedInstance) return;

    try {
      // Only send secrets the user actually typed — blank means "keep existing".
      const { apiKey, password, ...rest } = data;
      const instance = await updateGrafanaInstance(selectedInstance.id, {
        ...rest,
        ...(apiKey ? { apiKey } : {}),
        ...(password ? { password } : {}),
      });
      setInstances(instances.map(g => g.id === instance.id ? instance : g));
      setEditDialogOpen(false);
      setSelectedInstance(null);
      form.reset();
      onSnackbar({
        open: true,
        message: 'Grafana instance updated successfully',
        severity: 'success',
      });
    } catch (err) {
      form.setError('root', {
        message: err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to update Grafana instance',
      });
    }
  };

  const handleDelete = async (instanceId: string) => {
    try {
      await deleteGrafanaInstance(instanceId);
      setInstances(instances.filter(g => g.id !== instanceId));
      setDeleteDialogOpen(false);
      setSelectedInstance(null);
      onSnackbar({
        open: true,
        message: 'Grafana instance deleted successfully',
        severity: 'success',
      });
    } catch (err) {
      onSnackbar({
        open: true,
        message: err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to delete Grafana instance',
        severity: 'error',
      });
    }
  };

  const handleTestConnection = async (data: CreateGrafanaInstanceFormData) => {
    try {
      setTestingConnection(true);
      const result = await testGrafanaConnectionWithParams({
        clientUrl: data.clientUrl!,
        serverUrl: data.serverUrl,
        orgId: data.orgId!,
        apiKey: data.apiKey,
        username: data.username,
        password: data.password,
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

  const togglePasswordVisibility = (instanceId: string) => {
    const newVisiblePasswords = new Set(visiblePasswords);
    if (newVisiblePasswords.has(instanceId)) {
      newVisiblePasswords.delete(instanceId);
    } else {
      newVisiblePasswords.add(instanceId);
    }
    setVisiblePasswords(newVisiblePasswords);
  };

  const openEditDialog = (instance: GrafanaInstance) => {
    setSelectedInstance(instance);
    setEditDialogOpen(true);
  };

  const openDeleteDialog = (instance: GrafanaInstance) => {
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
    visiblePasswords,
    testingConnection,
    loadInstances,
    handleCreate,
    handleUpdate,
    handleDelete,
    handleTestConnection,
    togglePasswordVisibility,
    openEditDialog,
    openDeleteDialog,
    closeDialogs,
  };
}
