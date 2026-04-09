'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Box, Typography, Button, CircularProgress, Alert, Paper, Tabs, Tab,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  Delete as DeleteIcon,
  MonitorHeart as MonitorHeartIcon,
  Assessment as AssessmentIcon,
  Link as LinkIcon,
  Storage as StorageIcon,
  Timeline as TimelineIcon,
  Memory as MemoryIcon,
  Notifications as NotificationsIcon,
  Description as DescriptionIcon,
  TuneRounded as TuneIcon,
} from '@mui/icons-material';

// Hooks
import { useSystemData, useDashboardManagement, useSLOManagement, useReportingTemplateManagement } from './hooks';
import type { TabId } from './hooks';

// Components
import EnvironmentWorkloadSelector from './components/EnvironmentWorkloadSelector';
import DashboardSection from './components/DashboardSection';
import SLOSection from './components/SLOSection';
import DeepLinksSection from './components/DeepLinksSection';
import DynatraceSection from './components/DynatraceSection';
import DistributedTracingSection from './components/DistributedTracingSection';
import PyroscopeSection from './components/PyroscopeSection';
import NotificationsSection from './components/NotificationsSection';
import ReportingTemplatesSection from './components/ReportingTemplatesSection';
import AdaptSettingsSection from './components/AdaptSettingsSection';
import ConfigDialogs from './components/ConfigDialogs';
import TemplateManagementDialog from './components/TemplateManagementDialog';
import DeleteSystemDialog from './components/DeleteSystemDialog';

export default function SystemConfigurationPage() {
  const router = useRouter();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const dashboard = useDashboardManagement();
  const slo = useSLOManagement();
  const template = useReportingTemplateManagement();
  const systemData = useSystemData({
    onDashboardsLoad: dashboard.fetchApplicationDashboards,
    onBenchmarksLoad: slo.fetchBenchmarks,
  });

  // Load templates when tab becomes active
  useEffect(() => {
    if (systemData.activeTab === 'templates' && systemData.systemId && systemData.selectedEnvironment && systemData.selectedWorkload) {
      template.fetchTemplates(systemData.systemId, systemData.selectedEnvironment, systemData.selectedWorkload);
    }
  }, [systemData.activeTab, systemData.systemId, systemData.selectedEnvironment, systemData.selectedWorkload]);

  // Reset state when environment changes
  useEffect(() => {
    dashboard.clearDashboards();
    slo.clearBenchmarks();
    template.clearTemplates();
  }, [systemData.selectedEnvironment]);

  const handleBack = () => router.push('/systems');

  if (systemData.loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (systemData.error || !systemData.system) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{systemData.error || 'System not found'}</Alert>
        <Button startIcon={<ArrowBackIcon />} onClick={handleBack} sx={{ mt: 2 }}>
          Back to Systems
        </Button>
      </Box>
    );
  }

  const { system, systemId, selectedEnvironment, selectedWorkload, activeTab } = systemData;

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* Header */}
      <Box sx={{ mb: 4, px: 3, pt: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Button
            startIcon={<ArrowBackIcon />}
            onClick={handleBack}
            sx={{
              textTransform: 'none',
              color: 'text.secondary',
              '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
            }}
          >
            Back to Systems
          </Button>
          <Button
            startIcon={<DeleteIcon />}
            color="error"
            variant="outlined"
            size="small"
            onClick={() => setDeleteDialogOpen(true)}
          >
            Delete System
          </Button>
        </Box>
        <Typography variant="h4" component="h1" fontWeight="bold" gutterBottom>
          {system.name}
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Configure dashboards, service level objectives, and integrations for this system
        </Typography>
      </Box>

      <Paper sx={{ mx: 3, mb: 3 }}>
        <EnvironmentWorkloadSelector
          selectedEnvironment={selectedEnvironment}
          selectedWorkload={selectedWorkload}
          availableEnvironments={systemData.availableEnvironments}
          availableWorkloads={systemData.availableWorkloads}
          onEnvironmentChange={systemData.handleEnvironmentChange}
          onWorkloadChange={systemData.handleWorkloadChange}
        />

        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tabs
            value={activeTab}
            onChange={(_, v: TabId) => systemData.handleTabChange(v)}
            aria-label="configuration sections"
            variant="scrollable"
            scrollButtons="auto"
            sx={{ px: 3 }}
          >
            <Tab value="grafana" icon={<MonitorHeartIcon />} label="Grafana dashboards" />
            <Tab value="slo" icon={<AssessmentIcon />} label="Service Level Objectives" />
            <Tab value="deep-links" icon={<LinkIcon />} label="Deep Links" />
            {systemData.hasDynatrace && <Tab value="dynatrace" icon={<StorageIcon />} label="Dynatrace" />}
            {systemData.hasTracing && <Tab value="tracing" icon={<TimelineIcon />} label="Distributed Tracing" />}
            {systemData.hasPyroscope && <Tab value="pyroscope" icon={<MemoryIcon />} label="Pyroscope" />}
            <Tab value="notifications" icon={<NotificationsIcon />} label="Notifications" />
            <Tab value="templates" icon={<DescriptionIcon />} label="Reporting Templates" />
            <Tab value="adapt-settings" icon={<TuneIcon />} label="ADAPT Settings" />
          </Tabs>
        </Box>

        <Box>
          {activeTab === 'grafana' && (
            <DashboardSection
              systemId={systemId}
              systemName={system.name}
              selectedEnvironment={selectedEnvironment}
              selectedWorkload={selectedWorkload}
              dashboards={dashboard.dashboards}
              loading={dashboard.dashboardsLoading}
              searchText={dashboard.dashboardSearchText}
              onSearchChange={dashboard.setDashboardSearchText}
              selectedTags={dashboard.selectedDashboardTags}
              onTagToggle={dashboard.handleDashboardTagToggle}
              onClearTags={dashboard.clearDashboardTags}
              onAddDashboard={() => dashboard.handleAddDashboard(system.organization_id)}
              onEditDashboard={dashboard.handleEditDashboard}
              onDeleteDashboard={dashboard.handleDeleteDashboard}
              onBatchDelete={(ids, del) =>
                dashboard.handleBatchDeleteDashboards(ids, del, system.name, selectedEnvironment)
              }
            />
          )}
          {activeTab === 'slo' && (
            <SLOSection
              systemId={systemId}
              systemName={system.name}
              selectedEnvironment={selectedEnvironment}
              selectedWorkload={selectedWorkload}
              benchmarks={slo.benchmarks}
              loading={slo.benchmarksLoading}
              searchText={slo.sloSearchText}
              onSearchChange={slo.setSloSearchText}
              selectedTags={slo.selectedSloTags}
              onTagToggle={slo.handleSloTagToggle}
              onClearTags={slo.clearSloTags}
              onAddSLO={slo.handleAddSLO}
              onEditSLO={slo.handleEditSLO}
              onDeleteSLO={slo.handleDeleteSLO}
              onViewSLO={slo.handleViewSLO}
              onBatchDelete={(ids) =>
                slo.handleBatchDeleteSLOs(ids, systemId, selectedEnvironment, selectedWorkload)
              }
            />
          )}
          {activeTab === 'deep-links' && (
            <DeepLinksSection
              systemId={systemId}
              systemName={system.name}
              selectedEnvironment={selectedEnvironment}
              selectedWorkload={selectedWorkload}
            />
          )}
          {activeTab === 'dynatrace' && systemData.hasDynatrace && (
            <DynatraceSection
              systemId={systemId}
              systemName={system.name}
              selectedEnvironment={selectedEnvironment}
              selectedWorkload={selectedWorkload}
            />
          )}
          {activeTab === 'tracing' && systemData.hasTracing && (
            <DistributedTracingSection
              systemId={systemId}
              systemName={system.name}
              selectedEnvironment={selectedEnvironment}
              selectedWorkload={selectedWorkload}
            />
          )}
          {activeTab === 'pyroscope' && systemData.hasPyroscope && (
            <PyroscopeSection
              systemId={systemId}
              systemUnderTest={system}
              onUpdate={systemData.setSystem}
            />
          )}
          {activeTab === 'notifications' && (
            <NotificationsSection systemId={systemId} systemName={system.name} />
          )}
          {activeTab === 'templates' && (
            <ReportingTemplatesSection
              systemId={systemId}
              systemName={system.name}
              selectedEnvironment={selectedEnvironment}
              selectedWorkload={selectedWorkload}
              templates={template.templates}
              loading={template.templatesLoading}
              searchText={template.templateSearchText}
              onSearchChange={template.setTemplateSearchText}
              onAddTemplate={template.handleCreateTemplate}
              onEditTemplate={template.handleEditTemplate}
              onDeleteTemplate={template.handleDeleteTemplate}
              onDuplicateTemplate={async (t, name) => {
                await template.handleDuplicateTemplate(t, name);
                await template.fetchTemplates(systemId, selectedEnvironment, selectedWorkload);
              }}
              onSetDefaultTemplate={async (id) => {
                await template.handleSetDefaultTemplate(id, systemId, selectedEnvironment, selectedWorkload);
              }}
              onBatchDelete={async (ids) => {
                await template.handleBatchDelete(ids);
              }}
            />
          )}
          {activeTab === 'adapt-settings' && (
            <AdaptSettingsSection
              systemId={systemId}
              selectedEnvironment={selectedEnvironment}
              selectedWorkload={selectedWorkload}
            />
          )}
        </Box>
      </Paper>

      <ConfigDialogs
        systemId={systemId}
        systemName={system.name}
        selectedEnvironment={selectedEnvironment}
        selectedWorkload={selectedWorkload}
        dashboard={{
          addDashboardOpen: dashboard.addDashboardOpen,
          editDashboardOpen: dashboard.editDashboardOpen,
          deleteConfirmOpen: dashboard.deleteConfirmOpen,
          editingDashboard: dashboard.editingDashboard,
          deletingDashboard: dashboard.deletingDashboard,
          deleteInfo: dashboard.deleteInfo,
          deleteFromGrafana: dashboard.deleteFromGrafana,
          availableGrafanaDashboards: dashboard.availableGrafanaDashboards,
          formLoading: dashboard.formLoading,
          editFormLoading: dashboard.editFormLoading,
          deleteLoading: dashboard.deleteLoading,
        }}
        slo={{
          addSloOpen: slo.addSloOpen,
          editSloOpen: slo.editSloOpen,
          deleteSloOpen: slo.deleteSloOpen,
          editingSlo: slo.editingSlo,
          deletingSlo: slo.deletingSlo,
          deleteSloLoading: slo.deleteSloLoading,
        }}
        onAddDashboardClose={() => dashboard.setAddDashboardOpen(false)}
        onAddDashboardSubmit={(id, label, vars) =>
          dashboard.handleSubmitDashboard(id, label, vars, systemId, system.name, selectedEnvironment)
        }
        onEditDashboardClose={() => dashboard.setEditDashboardOpen(false)}
        onEditDashboardSubmit={(label, vars) =>
          dashboard.handleSubmitEditDashboard(label, vars, system.name, selectedEnvironment)
        }
        onDeleteDashboardClose={dashboard.clearDeleteState}
        onDeleteDashboardConfirm={() => dashboard.handleConfirmDelete(system.name, selectedEnvironment)}
        onDeleteFromGrafanaChange={dashboard.setDeleteFromGrafana}
        onAddSloClose={() => slo.setAddSloOpen(false)}
        onSLOCreated={(newSLO) =>
          slo.handleSLOCreated(newSLO, systemId, selectedEnvironment, selectedWorkload)
        }
        onEditSloClose={slo.closeEditSloDialog}
        onSLOUpdated={(updated) =>
          slo.handleSLOUpdated(updated, systemId, selectedEnvironment, selectedWorkload)
        }
        onDeleteSloClose={() => slo.setDeleteSloOpen(false)}
        onDeleteSloConfirm={async () => {
          await slo.handleConfirmDeleteSLO(systemId, selectedEnvironment, selectedWorkload);
        }}
      />

      {/* Template Management Dialogs */}
      <TemplateManagementDialog
        open={template.createTemplateOpen || template.editTemplateOpen}
        onClose={() => {
          template.setCreateTemplateOpen(false);
          template.setEditTemplateOpen(false);
        }}
        template={template.editingTemplate}
        systemId={systemId}
        systemName={system.name}
        testEnvironment={selectedEnvironment}
        workload={selectedWorkload}
        isEdit={template.editTemplateOpen}
        onSubmit={async (name, description, sections, styling, isDefault) => {
          if (template.editTemplateOpen) {
            await template.handleSubmitEditTemplate(name, description, sections, styling, isDefault);
            await template.fetchTemplates(systemId, selectedEnvironment, selectedWorkload);
          } else {
            await template.handleSubmitTemplate(name, description, sections, styling, isDefault, systemId, selectedEnvironment, selectedWorkload);
          }
        }}
        loading={template.formLoading || template.editFormLoading}
      />

      {/* Template Delete Confirmation Dialog */}
      <Dialog
        open={template.deleteConfirmOpen}
        onClose={() => template.setDeleteConfirmOpen(false)}
      >
        <DialogTitle>Delete Template</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete the template "{template.deletingTemplate?.name}"?
            This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => template.setDeleteConfirmOpen(false)} disabled={template.deleteLoading}>
            Cancel
          </Button>
          <Button
            onClick={async () => {
              await template.handleConfirmDelete();
            }}
            color="error"
            variant="contained"
            disabled={template.deleteLoading}
          >
            {template.deleteLoading ? <CircularProgress size={20} /> : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      <DeleteSystemDialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        systemId={systemId}
        systemName={system.name}
      />
    </Box>
  );
}
