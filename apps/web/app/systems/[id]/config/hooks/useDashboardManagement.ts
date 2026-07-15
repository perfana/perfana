'use client';

import { useState, useCallback } from 'react';
import { ApplicationDashboard } from '@/lib/types';
import { authenticatedFetch } from '@/lib/api';
import { GrafanaDashboard, VariableValue } from '../components/types';

interface DeleteInfo {
  canDeleteFromGrafana: boolean;
  grafanaDashboardName: string;
  grafanaDashboardUid: string;
  otherSuts: string[];
}

interface UseDashboardManagementReturn {
  // State
  dashboards: ApplicationDashboard[];
  dashboardsLoading: boolean;
  availableGrafanaDashboards: GrafanaDashboard[];

  // Filter state
  dashboardSearchText: string;
  selectedDashboardTags: string[];

  // Dialog state
  addDashboardOpen: boolean;
  editDashboardOpen: boolean;
  deleteConfirmOpen: boolean;
  editingDashboard: ApplicationDashboard | null;
  deletingDashboard: ApplicationDashboard | null;
  deleteInfo: DeleteInfo | null;
  deleteFromGrafana: boolean;

  // Loading states
  formLoading: boolean;
  editFormLoading: boolean;
  deleteLoading: boolean;
  deleteError: string | null;

  // Actions
  fetchApplicationDashboards: (systemId: string, environment: string) => Promise<void>;
  handleAddDashboard: (organizationId?: string | null) => Promise<void>;
  handleSubmitDashboard: (
    dashboardId: string,
    label: string,
    variables: VariableValue[],
    systemId: string,
    environment: string
  ) => Promise<void>;
  handleEditDashboard: (dashboard: ApplicationDashboard) => void;
  handleSubmitEditDashboard: (
    label: string,
    variables: VariableValue[],
    systemId: string,
    environment: string
  ) => Promise<void>;
  handleDeleteDashboard: (dashboard: ApplicationDashboard) => Promise<void>;
  handleConfirmDelete: (systemId: string, environment: string) => Promise<void>;
  handleBatchDeleteDashboards: (
    ids: string[],
    deleteFromGrafana: boolean,
    systemId: string,
    environment: string
  ) => Promise<void>;

  // Filter actions
  setDashboardSearchText: (text: string) => void;
  handleDashboardTagToggle: (tag: string) => void;
  clearDashboardTags: () => void;

  // Dialog actions
  setAddDashboardOpen: (open: boolean) => void;
  setEditDashboardOpen: (open: boolean) => void;
  setDeleteConfirmOpen: (open: boolean) => void;
  setDeleteFromGrafana: (value: boolean) => void;
  clearDeleteState: () => void;
  clearDashboards: () => void;
}

export function useDashboardManagement(): UseDashboardManagementReturn {
  // State
  const [dashboards, setDashboards] = useState<ApplicationDashboard[]>([]);
  const [dashboardsLoading, setDashboardsLoading] = useState(false);
  const [availableGrafanaDashboards, setAvailableGrafanaDashboards] = useState<GrafanaDashboard[]>([]);

  // Filter state
  const [dashboardSearchText, setDashboardSearchText] = useState('');
  const [selectedDashboardTags, setSelectedDashboardTags] = useState<string[]>([]);

  // Dialog state
  const [addDashboardOpen, setAddDashboardOpen] = useState(false);
  const [editDashboardOpen, setEditDashboardOpen] = useState(false);
  const [editingDashboard, setEditingDashboard] = useState<ApplicationDashboard | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletingDashboard, setDeletingDashboard] = useState<ApplicationDashboard | null>(null);
  const [deleteInfo, setDeleteInfo] = useState<DeleteInfo | null>(null);
  const [deleteFromGrafana, setDeleteFromGrafana] = useState(false);

  // Loading states
  const [formLoading, setFormLoading] = useState(false);
  const [editFormLoading, setEditFormLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Fetch application dashboards
  const fetchApplicationDashboards = useCallback(async (systemId: string, environment: string) => {
    try {
      setDashboardsLoading(true);

      const response = await authenticatedFetch(
        `/grafana/application-dashboards?systemId=${encodeURIComponent(systemId)}&environment=${encodeURIComponent(environment)}`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch application dashboards');
      }

      const data = await response.json();
      setDashboards(data || []);
    } catch (err) {
      setDashboards([]);
    } finally {
      setDashboardsLoading(false);
    }
  }, []);

  // Fetch available Grafana dashboards, scoped to the system's organization
  const fetchAvailableGrafanaDashboards = useCallback(async (organizationId?: string | null) => {
    try {
      // First fetch grafana instances for this organization
      const instancesUrl = organizationId
        ? `/grafana-instances?organizationId=${encodeURIComponent(organizationId)}`
        : `/grafana-instances`;
      const instancesResponse = await authenticatedFetch(instancesUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!instancesResponse.ok) {
        throw new Error('Failed to fetch grafana instances');
      }

      const instances = await instancesResponse.json();

      if (!instances || instances.length === 0) {
        setAvailableGrafanaDashboards([]);
        return;
      }

      // Fetch dashboards for each instance and combine
      const allDashboards: GrafanaDashboard[] = [];
      for (const instance of instances) {
        const response = await authenticatedFetch(
          `/grafana/dashboards?grafanaInstanceId=${encodeURIComponent(instance.id)}`,
          {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
          }
        );

        if (response.ok) {
          const data = await response.json();
          if (data) allDashboards.push(...data);
        }
      }

      setAvailableGrafanaDashboards(allDashboards);
    } catch (err) {
      // Error fetching available dashboards, silently handle
    }
  }, []);

  // Handle add dashboard
  const handleAddDashboard = useCallback(async (organizationId?: string | null) => {
    if (availableGrafanaDashboards.length === 0) {
      await fetchAvailableGrafanaDashboards(organizationId);
    }
    setAddDashboardOpen(true);
  }, [availableGrafanaDashboards.length, fetchAvailableGrafanaDashboards]);

  // Submit new dashboard
  const handleSubmitDashboard = useCallback(async (
    dashboardId: string,
    label: string,
    variables: VariableValue[],
    systemId: string,
    environment: string
  ) => {
    try {
      setFormLoading(true);

      const selectedDashboard = availableGrafanaDashboards.find(d => d.id === dashboardId);
      if (!selectedDashboard) {
        throw new Error('Selected dashboard not found');
      }

      const payload = {
        systemUnderTestId: systemId,
        testEnvironment: environment,
        grafanaInstanceId: selectedDashboard.grafana_instance_id,
        grafanaDashboardId: selectedDashboard.id,
        dashboardName: selectedDashboard.name,
        dashboardUid: selectedDashboard.uid,
        dashboardLabel: label,
        variables: variables,
        tags: selectedDashboard.tags
          ? selectedDashboard.tags.filter(tag => !['system', 'environment', 'workload'].includes(tag))
          : []
      };

      const response = await authenticatedFetch(`/grafana/application-dashboards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error('Failed to add dashboard configuration');
      }

      await fetchApplicationDashboards(systemId, environment);
      setAddDashboardOpen(false);
    } finally {
      setFormLoading(false);
    }
  }, [availableGrafanaDashboards, fetchApplicationDashboards]);

  // Handle edit dashboard
  const handleEditDashboard = useCallback((dashboard: ApplicationDashboard) => {
    setEditingDashboard(dashboard);
    setEditDashboardOpen(true);
  }, []);

  // Submit edit dashboard
  const handleSubmitEditDashboard = useCallback(async (
    label: string,
    variables: VariableValue[],
    systemId: string,
    environment: string
  ) => {
    if (!editingDashboard) return;

    try {
      setEditFormLoading(true);

      const payload = {
        dashboardLabel: label,
        variables: variables
      };

      const response = await authenticatedFetch(
        `/grafana/application-dashboards/${editingDashboard.id}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to update dashboard configuration');
      }

      await fetchApplicationDashboards(systemId, environment);
      setEditDashboardOpen(false);
      setEditingDashboard(null);
    } finally {
      setEditFormLoading(false);
    }
  }, [editingDashboard, fetchApplicationDashboards]);

  // Handle delete dashboard
  const handleDeleteDashboard = useCallback(async (dashboard: ApplicationDashboard) => {
    try {
      const response = await authenticatedFetch(
        `/grafana/application-dashboards/${dashboard.id}/delete-info`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        }
      );

      if (response.ok) {
        const info = await response.json();
        setDeleteInfo(info);
      } else {
        setDeleteInfo(null);
      }
    } catch {
      setDeleteInfo(null);
    }

    setDeleteFromGrafana(false);
    setDeleteError(null);
    setDeletingDashboard(dashboard);
    setDeleteConfirmOpen(true);
  }, []);

  // Confirm delete
  const handleConfirmDelete = useCallback(async (systemId: string, environment: string) => {
    if (!deletingDashboard) return;

    try {
      setDeleteLoading(true);
      setDeleteError(null);

      const deleteUrl = deleteFromGrafana && deleteInfo?.canDeleteFromGrafana
        ? `/grafana/application-dashboards/${deletingDashboard.id}?deleteFromGrafana=true`
        : `/grafana/application-dashboards/${deletingDashboard.id}`;

      const response = await authenticatedFetch(deleteUrl, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const message = body?.message
          ?? body?.error
          ?? `Failed to delete dashboard configuration (${response.status} ${response.statusText})`;
        throw new Error(message);
      }

      await fetchApplicationDashboards(systemId, environment);
      setDeleteConfirmOpen(false);
      setDeletingDashboard(null);
      setDeleteInfo(null);
      setDeleteFromGrafana(false);
    } catch (err) {
      setDeleteError(
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to delete dashboard configuration'
      );
    } finally {
      setDeleteLoading(false);
    }
  }, [deletingDashboard, deleteFromGrafana, deleteInfo, fetchApplicationDashboards]);

  // Batch delete dashboards
  const handleBatchDeleteDashboards = useCallback(async (
    ids: string[],
    deleteFromGrafanaFlag: boolean,
    systemId: string,
    environment: string
  ) => {
    await Promise.all(
      ids.map(id => {
        const deleteUrl = deleteFromGrafanaFlag
          ? `/grafana/application-dashboards/${id}?deleteFromGrafana=true`
          : `/grafana/application-dashboards/${id}`;
        return authenticatedFetch(deleteUrl, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
        });
      })
    );

    await fetchApplicationDashboards(systemId, environment);
  }, [fetchApplicationDashboards]);

  // Handle dashboard tag toggle
  const handleDashboardTagToggle = useCallback((tag: string) => {
    setSelectedDashboardTags(prev =>
      prev.includes(tag)
        ? prev.filter(t => t !== tag)
        : [...prev, tag]
    );
  }, []);

  // Clear dashboard tags
  const clearDashboardTags = useCallback(() => {
    setSelectedDashboardTags([]);
  }, []);

  // Clear delete state
  const clearDeleteState = useCallback(() => {
    setDeleteConfirmOpen(false);
    setDeleteInfo(null);
    setDeleteFromGrafana(false);
    setDeleteError(null);
  }, []);

  // Clear dashboards (when environment changes)
  const clearDashboards = useCallback(() => {
    setDashboards([]);
  }, []);

  return {
    // State
    dashboards,
    dashboardsLoading,
    availableGrafanaDashboards,

    // Filter state
    dashboardSearchText,
    selectedDashboardTags,

    // Dialog state
    addDashboardOpen,
    editDashboardOpen,
    deleteConfirmOpen,
    editingDashboard,
    deletingDashboard,
    deleteInfo,
    deleteFromGrafana,

    // Loading states
    formLoading,
    editFormLoading,
    deleteLoading,
    deleteError,

    // Actions
    fetchApplicationDashboards,
    handleAddDashboard,
    handleSubmitDashboard,
    handleEditDashboard,
    handleSubmitEditDashboard,
    handleDeleteDashboard,
    handleConfirmDelete,
    handleBatchDeleteDashboards,

    // Filter actions
    setDashboardSearchText,
    handleDashboardTagToggle,
    clearDashboardTags,

    // Dialog actions
    setAddDashboardOpen,
    setEditDashboardOpen,
    setDeleteConfirmOpen,
    setDeleteFromGrafana,
    clearDeleteState,
    clearDashboards,
  };
}
