'use client';

import { useState, useEffect, useCallback } from 'react';
import { authenticatedFetch } from '@/lib/api';
import {
  TracingService,
  TracingInstance,
  TracingServiceFormData,
  UseDistributedTracingDataProps,
  INITIAL_FORM_DATA,
  serviceToFormData,
  formDataToPayload,
} from '../types';

export function useDistributedTracingData({
  systemId,
  onSnackbar,
}: UseDistributedTracingDataProps) {
  // State
  const [tracingServices, setTracingServices] = useState<TracingService[]>([]);
  const [tracingInstances, setTracingInstances] = useState<TracingInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [formData, setFormData] = useState<TracingServiceFormData>(INITIAL_FORM_DATA);
  const [editingService, setEditingService] = useState<TracingService | null>(null);
  const [deletingService, setDeletingService] = useState<TracingService | null>(null);
  const [saving, setSaving] = useState(false);
  const [availableEnvironments, setAvailableEnvironments] = useState<string[]>([]);
  const [availableWorkloads, setAvailableWorkloads] = useState<string[]>([]);

  // Load tracing services
  const loadTracingServices = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await authenticatedFetch(
        `/tracing-services/all?systemId=${systemId}`
      );

      if (!response.ok) {
        throw new Error('Failed to load tracing services');
      }

      const data = await response.json();
      setTracingServices(data || []);
    } catch (err) {
      const message =
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to load tracing services';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [systemId]);

  // Load tracing instances
  const loadTracingInstances = useCallback(async () => {
    try {
      const response = await authenticatedFetch('/tracing-instances');

      if (!response.ok) {
        throw new Error('Failed to load tracing instances');
      }

      const data = await response.json();
      setTracingInstances(data || []);
    } catch (err) {
      // Silently handle error - instances are supplementary
    }
  }, []);

  // Load system environments and workloads
  const loadSystemEnvironments = useCallback(async () => {
    try {
      const response = await authenticatedFetch(`/systems-under-test/${systemId}`);

      if (!response.ok) {
        throw new Error('Failed to load system data');
      }

      const systemData = await response.json();

      if (systemData.environments) {
        const environments = systemData.environments.map(
          (env: { environment: string }) => env.environment
        );
        setAvailableEnvironments(environments);

        // Extract all unique workloads across environments
        const allWorkloads = new Set<string>();
        systemData.environments.forEach(
          (env: { workloads?: string[] }) => {
            if (env.workloads) {
              env.workloads.forEach((workload: string) => allWorkloads.add(workload));
            }
          }
        );
        setAvailableWorkloads(Array.from(allWorkloads).sort());
      }
    } catch (err) {
      // Silently handle error - environments are supplementary
    }
  }, [systemId]);

  // Load data on mount
  useEffect(() => {
    loadTracingServices();
    loadTracingInstances();
    loadSystemEnvironments();
  }, [loadTracingServices, loadTracingInstances, loadSystemEnvironments]);

  // Handle form field changes
  const handleFormChange = (field: keyof TracingServiceFormData, value: unknown) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
      // Reset environment/workload when level changes
      ...(field === 'level' && {
        environment: value === 'system' ? '' : prev.environment,
        workload: value === 'system' || value === 'environment' ? '' : prev.workload,
      }),
    }));
  };

  // Validate form data
  const validateFormData = (): string | null => {
    if (!formData.tracing_instance_id) {
      return 'Please select a tracing instance';
    }
    if (formData.service_names.length === 0) {
      return 'Please add at least one service name';
    }
    if (formData.level !== 'system' && !formData.environment) {
      return 'Environment is required for environment/workload level';
    }
    if (formData.level === 'workload' && !formData.workload) {
      return 'Workload is required for workload level';
    }
    return null;
  };

  // Save (create or update) tracing service
  const handleSave = async () => {
    const validationError = validateFormData();
    if (validationError) {
      onSnackbar({ open: true, message: validationError, severity: 'error' });
      return;
    }

    try {
      setSaving(true);

      const payload = formDataToPayload(formData, systemId);
      const url = editingService
        ? `/tracing-services/${editingService.id}`
        : '/tracing-services';
      const method = editingService ? 'PATCH' : 'POST';

      const response = await authenticatedFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(
          `Failed to ${editingService ? 'update' : 'create'} tracing service`
        );
      }

      onSnackbar({
        open: true,
        message: `Tracing service ${editingService ? 'updated' : 'created'} successfully`,
        severity: 'success',
      });
      closeDialogs();
      await loadTracingServices();
    } catch (err) {
      onSnackbar({
        open: true,
        message:
          err && typeof err === 'object' && 'message' in err
            ? (err as Error).message
            : 'Failed to save tracing service',
        severity: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  // Delete tracing service
  const handleDelete = async () => {
    if (!deletingService) return;

    try {
      setSaving(true);

      const response = await authenticatedFetch(
        `/tracing-services/${deletingService.id}`,
        { method: 'DELETE' }
      );

      if (!response.ok) {
        throw new Error('Failed to delete tracing service');
      }

      onSnackbar({
        open: true,
        message: 'Tracing service deleted successfully',
        severity: 'success',
      });
      setDeleteDialogOpen(false);
      setDeletingService(null);
      await loadTracingServices();
    } catch (err) {
      onSnackbar({
        open: true,
        message:
          err && typeof err === 'object' && 'message' in err
            ? (err as Error).message
            : 'Failed to delete tracing service',
        severity: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  // Open add dialog
  const openAddDialog = () => {
    setFormData(INITIAL_FORM_DATA);
    setAddDialogOpen(true);
  };

  // Open edit dialog
  const openEditDialog = (service: TracingService) => {
    setEditingService(service);
    setFormData(serviceToFormData(service));
    setEditDialogOpen(true);
  };

  // Open delete dialog
  const openDeleteDialog = (service: TracingService) => {
    setDeletingService(service);
    setDeleteDialogOpen(true);
  };

  // Close all dialogs
  const closeDialogs = () => {
    setAddDialogOpen(false);
    setEditDialogOpen(false);
    setDeleteDialogOpen(false);
    setEditingService(null);
    setDeletingService(null);
    setFormData(INITIAL_FORM_DATA);
  };

  return {
    // State
    tracingServices,
    tracingInstances,
    loading,
    error,
    formData,
    saving,
    addDialogOpen,
    editDialogOpen,
    deleteDialogOpen,
    editingService,
    deletingService,
    availableEnvironments,
    availableWorkloads,
    // Actions
    setFormData,
    handleFormChange,
    handleSave,
    handleDelete,
    openAddDialog,
    openEditDialog,
    openDeleteDialog,
    closeDialogs,
    setAddDialogOpen,
    setEditDialogOpen,
    setDeleteDialogOpen,
  };
}
