'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  fetchDynatraceConfigs,
  createDynatraceConfig,
  updateDynatraceConfig,
  testDynatraceConnection,
  fetchRequestAttributesForHost,
  deleteDynatraceConfig,
  type DynatraceConfig,
  type CreateDynatraceConfigDto,
  type UpdateDynatraceConfigDto,
  type DynatraceRequestAttribute,
} from '@/lib/dynatrace';
import {
  createDynatraceConfigSchema,
  CreateDynatraceConfigFormInput,
  type CreateDynatraceConfigFormData,
} from '@/lib/validations';
import { SnackbarState } from '../types';

interface UseDynatraceIntegrationProps {
  onSnackbar: (state: SnackbarState) => void;
  organizationId?: string | null;
}

export function useDynatraceIntegration({ onSnackbar, organizationId }: UseDynatraceIntegrationProps) {
  const [configs, setConfigs] = useState<DynatraceConfig[]>([]);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedConfig, setSelectedConfig] = useState<DynatraceConfig | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const [requestAttributes, setRequestAttributes] = useState<DynatraceRequestAttribute[]>([]);
  const [loadingAttributes, setLoadingAttributes] = useState(false);
  const [selectedTestRunIdAttribute, setSelectedTestRunIdAttribute] = useState<string>('');
  const [selectedRequestNameAttribute, setSelectedRequestNameAttribute] = useState<string>('');

  // Three generics, not one: the schema's `.default('saas')` makes zod's input and
  // output types differ, and a single generic cannot be both.
  const form = useForm<CreateDynatraceConfigFormInput, unknown, CreateDynatraceConfigFormData>({
    resolver: zodResolver(createDynatraceConfigSchema),
    defaultValues: {
      label: '',
      host: '',
      clientUrl: '',
      apiToken: '',
      platformApiToken: '',
      dynatraceType: 'saas' as const,
      useProxy: false,
    },
  });

  // Populate form when editing
  useEffect(() => {
    if (editDialogOpen && selectedConfig) {
      form.reset({
        label: selectedConfig.label || '',
        host: selectedConfig.host,
        clientUrl: selectedConfig.clientUrl || '',
        apiToken: '', // Don't pre-fill secrets — blank means "keep existing"
        platformApiToken: '',
        dynatraceType: selectedConfig.dynatraceType,
        useProxy: selectedConfig.useProxy ?? false,
      });

      // Load request attributes when opening edit dialog
      const loadAttributes = async () => {
        setLoadingAttributes(true);
        try {
          const response = await fetchRequestAttributesForHost(selectedConfig.host);
          setRequestAttributes(response.all || []);
        } catch (error) {
          console.error('Failed to load request attributes:', error);
          setRequestAttributes([]);
        } finally {
          setLoadingAttributes(false);
        }
      };
      loadAttributes();
    }
  }, [editDialogOpen, selectedConfig, form]);

  const loadConfigs = async () => {
    try {
      const loadedConfigs = await fetchDynatraceConfigs(organizationId);
      setConfigs(loadedConfigs);
    } catch (err) {
      console.error('Failed to load Dynatrace configs:', err);
    }
  };

  const handleCreate = async (data: CreateDynatraceConfigFormData) => {
    try {
      const createData: CreateDynatraceConfigDto = {
        label: data.label!,
        host: data.host!,
        ...(data.clientUrl && { clientUrl: data.clientUrl }),
        apiToken: data.apiToken!,
        dynatraceType: data.dynatraceType!,
        ...(data.platformApiToken && { platformApiToken: data.platformApiToken }),
        ...(selectedTestRunIdAttribute && { perfanaTestRunIdAttribute: selectedTestRunIdAttribute }),
        ...(selectedRequestNameAttribute && { perfanaRequestNameAttribute: selectedRequestNameAttribute }),
        useProxy: data.useProxy,
        ...(organizationId && { organizationId }),
      };

      const config = await createDynatraceConfig(createData);
      setConfigs([config, ...configs]);
      setCreateDialogOpen(false);
      form.reset();
      setRequestAttributes([]);
      setSelectedTestRunIdAttribute('');
      setSelectedRequestNameAttribute('');
      onSnackbar({
        open: true,
        message: 'Dynatrace configuration created successfully',
        severity: 'success',
      });
    } catch (err) {
      form.setError('root', {
        message: err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to create Dynatrace configuration',
      });
    }
  };

  const handleUpdate = async (data: CreateDynatraceConfigFormData) => {
    if (!selectedConfig) return;

    try {
      const updateData: UpdateDynatraceConfigDto = {
        label: data.label,
        // Always sent, '' included: that is how the user clears it.
        clientUrl: data.clientUrl ?? '',
        perfanaTestRunIdAttribute: selectedTestRunIdAttribute || undefined,
        perfanaRequestNameAttribute: selectedRequestNameAttribute || undefined,
        useProxy: data.useProxy,
        // Only send secrets the user actually typed — blank means "keep existing".
        ...(data.apiToken ? { apiToken: data.apiToken } : {}),
        ...(data.platformApiToken ? { platformApiToken: data.platformApiToken } : {}),
      };

      await updateDynatraceConfig(selectedConfig.id, updateData);

      setEditDialogOpen(false);
      setSelectedConfig(null);
      form.reset();
      setRequestAttributes([]);
      setSelectedTestRunIdAttribute('');
      setSelectedRequestNameAttribute('');
      setLoadingAttributes(false);
      onSnackbar({
        open: true,
        message: 'Dynatrace configuration updated successfully',
        severity: 'success',
      });
      await loadConfigs();
    } catch (err) {
      form.setError('root', {
        message: err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to update Dynatrace configuration',
      });
    }
  };

  const handleDelete = async (configId: string) => {
    try {
      await deleteDynatraceConfig(configId);
      setConfigs(configs.filter(d => d.id !== configId));
      setDeleteDialogOpen(false);
      setSelectedConfig(null);
      onSnackbar({
        open: true,
        message: 'Dynatrace configuration deleted successfully',
        severity: 'success',
      });
    } catch (err) {
      onSnackbar({
        open: true,
        message: err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to delete Dynatrace configuration',
        severity: 'error',
      });
    }
  };

  const handleTestConnection = async (data: CreateDynatraceConfigFormData) => {
    try {
      setTestingConnection(true);
      const result = await testDynatraceConnection({
        host: data.host,
        apiToken: data.apiToken,
      });
      onSnackbar({
        open: true,
        message: `Connection successful! Dynatrace version: ${result.version || 'Unknown'}`,
        severity: 'success',
      });

      // Load request attributes after successful connection test
      try {
        setLoadingAttributes(true);
        const response = await fetchRequestAttributesForHost(data.host);
        setRequestAttributes(response.all || []);
      } catch (error) {
        console.error('Failed to load request attributes:', error);
      } finally {
        setLoadingAttributes(false);
      }
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

  const openEditDialog = (config: DynatraceConfig) => {
    setSelectedConfig(config);
    setSelectedTestRunIdAttribute(config.perfanaTestRunIdAttribute || '');
    setSelectedRequestNameAttribute(config.perfanaRequestNameAttribute || '');
    setEditDialogOpen(true);
  };

  const openDeleteDialog = (config: DynatraceConfig) => {
    setSelectedConfig(config);
    setDeleteDialogOpen(true);
  };

  const closeDialogs = () => {
    setCreateDialogOpen(false);
    setEditDialogOpen(false);
    setDeleteDialogOpen(false);
    setSelectedConfig(null);
    form.reset();
    setRequestAttributes([]);
    setSelectedTestRunIdAttribute('');
    setSelectedRequestNameAttribute('');
    setLoadingAttributes(false);
  };

  return {
    configs,
    form,
    createDialogOpen,
    setCreateDialogOpen,
    editDialogOpen,
    setEditDialogOpen,
    deleteDialogOpen,
    setDeleteDialogOpen,
    selectedConfig,
    testingConnection,
    requestAttributes,
    loadingAttributes,
    selectedTestRunIdAttribute,
    setSelectedTestRunIdAttribute,
    selectedRequestNameAttribute,
    setSelectedRequestNameAttribute,
    loadConfigs,
    handleCreate,
    handleUpdate,
    handleDelete,
    handleTestConnection,
    openEditDialog,
    openDeleteDialog,
    closeDialogs,
  };
}
