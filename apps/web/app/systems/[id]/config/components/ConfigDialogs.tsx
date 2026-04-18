'use client';

import { ApplicationDashboard } from '@/lib/types';
import AddDashboardDialog from './AddDashboardDialog';
import EditDashboardDialog from './EditDashboardDialog';
import DeleteConfirmationDialog from './DeleteConfirmationDialog';
import AddSLODialog from './AddSLODialog';
import EditSLODialog from './EditSLODialog';
import { Benchmark, GrafanaDashboard, VariableValue } from './types';

interface DeleteInfo {
  canDeleteFromGrafana: boolean;
  grafanaDashboardName: string;
  grafanaDashboardUid: string;
  otherSuts: string[];
}

interface DashboardDialogState {
  addDashboardOpen: boolean;
  editDashboardOpen: boolean;
  deleteConfirmOpen: boolean;
  editingDashboard: ApplicationDashboard | null;
  deletingDashboard: ApplicationDashboard | null;
  deleteInfo: DeleteInfo | null;
  deleteFromGrafana: boolean;
  availableGrafanaDashboards: GrafanaDashboard[];
  formLoading: boolean;
  editFormLoading: boolean;
  deleteLoading: boolean;
}

interface SLODialogState {
  addSloOpen: boolean;
  editSloOpen: boolean;
  deleteSloOpen: boolean;
  editingSlo: Benchmark | null;
  deletingSlo: Benchmark | null;
  deleteSloLoading: boolean;
}

interface ConfigDialogsProps {
  // System context
  systemId: string;
  systemName: string;
  selectedEnvironment: string;
  selectedWorkload: string;

  // Dashboard dialog state
  dashboard: DashboardDialogState;

  // SLO dialog state
  slo: SLODialogState;

  // Dashboard handlers
  onAddDashboardClose: () => void;
  onAddDashboardSubmit: (dashboardId: string, label: string, variables: VariableValue[]) => Promise<void>;
  onEditDashboardClose: () => void;
  onEditDashboardSubmit: (label: string, variables: VariableValue[]) => Promise<void>;
  onDeleteDashboardClose: () => void;
  onDeleteDashboardConfirm: () => Promise<void>;
  onDeleteFromGrafanaChange: (value: boolean) => void;

  // SLO handlers
  onAddSloClose: () => void;
  onSLOCreated: (newSLO: Benchmark) => void;
  onEditSloClose: () => void;
  onSLOUpdated: (updatedSLO: Benchmark) => void;
  onDeleteSloClose: () => void;
  onDeleteSloConfirm: () => Promise<void>;
}

export default function ConfigDialogs({
  systemId,
  systemName,
  selectedEnvironment,
  selectedWorkload,
  dashboard,
  slo,
  onAddDashboardClose,
  onAddDashboardSubmit,
  onEditDashboardClose,
  onEditDashboardSubmit,
  onDeleteDashboardClose,
  onDeleteDashboardConfirm,
  onDeleteFromGrafanaChange,
  onAddSloClose,
  onSLOCreated,
  onEditSloClose,
  onSLOUpdated,
  onDeleteSloClose,
  onDeleteSloConfirm,
}: ConfigDialogsProps) {
  return (
    <>
      {/* Dashboard Dialogs */}
      <AddDashboardDialog
        open={dashboard.addDashboardOpen}
        onClose={onAddDashboardClose}
        onSubmit={onAddDashboardSubmit}
        availableDashboards={dashboard.availableGrafanaDashboards}
        systemName={systemName}
        environment={selectedEnvironment}
        loading={dashboard.formLoading}
      />

      <EditDashboardDialog
        open={dashboard.editDashboardOpen}
        onClose={onEditDashboardClose}
        onSubmit={onEditDashboardSubmit}
        dashboard={dashboard.editingDashboard}
        loading={dashboard.editFormLoading}
        systemName={systemName}
        selectedEnvironment={selectedEnvironment}
      />

      <DeleteConfirmationDialog
        open={dashboard.deleteConfirmOpen}
        onClose={onDeleteDashboardClose}
        onConfirm={onDeleteDashboardConfirm}
        title="Delete Dashboard Configuration"
        message="Are you sure you want to delete this dashboard configuration? This action cannot be undone."
        itemName={dashboard.deletingDashboard?.dashboard_label}
        loading={dashboard.deleteLoading}
        grafanaOption={
          dashboard.deleteInfo
            ? {
                canDeleteFromGrafana: dashboard.deleteInfo.canDeleteFromGrafana,
                grafanaDashboardName: dashboard.deleteInfo.grafanaDashboardName,
                grafanaDashboardUid: dashboard.deleteInfo.grafanaDashboardUid,
                deleteFromGrafana: dashboard.deleteFromGrafana,
                onDeleteFromGrafanaChange,
              }
            : undefined
        }
      />

      {/* SLO Dialogs */}
      <DeleteConfirmationDialog
        open={slo.deleteSloOpen}
        onClose={onDeleteSloClose}
        onConfirm={onDeleteSloConfirm}
        title="Delete SLO"
        message="Are you sure you want to delete this service level objective? This action cannot be undone."
        itemName={slo.deletingSlo?.config_title || slo.deletingSlo?.metric_name}
        loading={slo.deleteSloLoading}
      />

      <AddSLODialog
        open={slo.addSloOpen}
        onClose={onAddSloClose}
        systemId={systemId}
        systemName={systemName}
        environment={selectedEnvironment}
        workload={selectedWorkload}
        onSLOCreated={onSLOCreated}
      />

      <EditSLODialog
        open={slo.editSloOpen}
        onClose={onEditSloClose}
        benchmark={slo.editingSlo}
        systemId={systemId}
        systemName={systemName}
        environment={selectedEnvironment}
        workload={selectedWorkload}
        onSLOUpdated={onSLOUpdated}
      />
    </>
  );
}
