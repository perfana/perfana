'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import NextLink from 'next/link';
import {
  Box, Typography, Button, CircularProgress, Alert, Paper, Tabs, Tab,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
  Breadcrumbs, Link as MuiLink,
} from '@mui/material';
import {
  Delete as DeleteIcon,
  FileDownload as FileDownloadIcon,
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
import { useAuth } from '@/contexts/auth-context';
import { GLOBAL_ADMIN_ROLES } from '@/lib/constants/roles';
import { env } from '@/lib/env';

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
import AggregatedSloDialog, { ExistingAggregatedBenchmark } from '@/app/test-runs/[id]/components/performance-analysis/AggregatedSloDialog';
import TemplateManagementDialog from './components/TemplateManagementDialog';
import DeleteSystemDialog from './components/DeleteSystemDialog';
import ExportSystemDialog from './components/ExportSystemDialog';

export default function SystemConfigurationPage() {
  const searchParams = useSearchParams();
  const { hasAnyRole } = useAuth();
  const isGlobalAdmin = hasAnyRole(Array.from(GLOBAL_ADMIN_ROLES));
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [aggregatedSloDialogOpen, setAggregatedSloDialogOpen] = useState(false);
  const [selectedAggregatedBenchmark, setSelectedAggregatedBenchmark] = useState<ExistingAggregatedBenchmark | null>(null);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemData.activeTab, systemData.systemId, systemData.selectedEnvironment, systemData.selectedWorkload]);

  // Reset state when environment changes
  useEffect(() => {
    dashboard.clearDashboards();
    slo.clearBenchmarks();
    template.clearTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemData.selectedEnvironment]);

  // When opened from a test run (fromTestRun=<test_run_id>), the breadcrumb leads
  // back to that test run instead of the systems list. The "Test Runs" crumb keeps
  // the filter context reconstructible from this page's own params.
  const fromTestRun = searchParams?.get('fromTestRun') || '';
  const testRunsHref = (() => {
    const params = new URLSearchParams();
    if (systemData.system?.name) params.set('system', systemData.system.name);
    const envParam = searchParams?.get('environment');
    const workloadParam = searchParams?.get('workload');
    if (envParam) params.set('environment', envParam);
    if (workloadParam) params.set('workload', workloadParam);
    const query = params.toString();
    return query ? `/test-runs?${query}` : '/test-runs';
  })();
  const configBreadcrumbs = (label: string) => (
    <Breadcrumbs>
      {fromTestRun
        ? [
            <MuiLink key="runs" component={NextLink} href={testRunsHref} underline="hover" color="inherit">
              Test Runs
            </MuiLink>,
            <MuiLink key="run" component={NextLink} href={`/test-runs/${encodeURIComponent(fromTestRun)}`} underline="hover" color="inherit">
              {fromTestRun}
            </MuiLink>,
          ]
        : (
            <MuiLink component={NextLink} href="/systems" underline="hover" color="inherit">
              Systems
            </MuiLink>
          )}
      <Typography color="text.primary" aria-current="page">{label}</Typography>
    </Breadcrumbs>
  );

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
        {configBreadcrumbs('Configuration')}
        <Alert severity="error" sx={{ mt: 2 }}>{systemData.error || 'System not found'}</Alert>
      </Box>
    );
  }

  const { system, systemId, selectedEnvironment, selectedWorkload, activeTab } = systemData;

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* Header */}
      <Box sx={{ mb: 4, px: 3, pt: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          {configBreadcrumbs('Configuration')}
          <Box sx={{ display: 'flex', gap: 1 }}>
            {env.SUT_TRANSFER_ENABLED && isGlobalAdmin && (
              <Button
                startIcon={<FileDownloadIcon />}
                variant="outlined"
                size="small"
                onClick={() => setExportDialogOpen(true)}
              >
                Export (admin)
              </Button>
            )}
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
              error={dashboard.dashboardsError}
              onRetry={() =>
                selectedEnvironment &&
                dashboard.fetchApplicationDashboards(systemId, selectedEnvironment)
              }
              searchText={dashboard.dashboardSearchText}
              onSearchChange={dashboard.setDashboardSearchText}
              selectedTags={dashboard.selectedDashboardTags}
              onTagToggle={dashboard.handleDashboardTagToggle}
              onClearTags={dashboard.clearDashboardTags}
              onAddDashboard={() => dashboard.handleAddDashboard(system.organization_id)}
              onEditDashboard={dashboard.handleEditDashboard}
              onDeleteDashboard={dashboard.handleDeleteDashboard}
              onBatchDelete={(ids, del) =>
                // The child leaves `del` optional; the hook requires a boolean.
                // Default false — not deleting from Grafana is the safe reading.
                dashboard.handleBatchDeleteDashboards(ids, del ?? false, systemId, selectedEnvironment)
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
              onAddAggregatedSLO={() => {
                setSelectedAggregatedBenchmark(null);
                setAggregatedSloDialogOpen(true);
              }}
              onEditSLO={(benchmark) => {
                if (benchmark.benchmark_type === 'aggregated') {
                  setSelectedAggregatedBenchmark({
                    id: benchmark.id,
                    aggregate_metric: benchmark.aggregate_metric as ExistingAggregatedBenchmark['aggregate_metric'],
                    aggregate_stat: benchmark.aggregate_stat as ExistingAggregatedBenchmark['aggregate_stat'],
                    requirement_operator: benchmark.requirement_operator ?? '<=',
                    requirement_value: benchmark.requirement_value ?? 0,
                    exclude_ramp_up_time: benchmark.exclude_ramp_up_time,
                    enabled: benchmark.enabled,
                  });
                  setAggregatedSloDialogOpen(true);
                  return;
                }
                slo.handleEditSLO(benchmark);
              }}
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
          deleteError: dashboard.deleteError,
        }}
        slo={{
          addSloOpen: slo.addSloOpen,
          editSloOpen: slo.editSloOpen,
          deleteSloOpen: slo.deleteSloOpen,
          editingSlo: slo.editingSlo,
          deletingSlo: slo.deletingSlo,
          deleteSloLoading: slo.deleteSloLoading,
          deleteSloError: slo.deleteSloError,
        }}
        onAddDashboardClose={() => dashboard.setAddDashboardOpen(false)}
        onAddDashboardSubmit={(id, label, vars) =>
          dashboard.handleSubmitDashboard(id, label, vars, systemId, selectedEnvironment)
        }
        onEditDashboardClose={() => dashboard.setEditDashboardOpen(false)}
        onEditDashboardSubmit={(label, vars) =>
          dashboard.handleSubmitEditDashboard(label, vars, systemId, selectedEnvironment)
        }
        onDeleteDashboardClose={dashboard.clearDeleteState}
        onDeleteDashboardConfirm={() => dashboard.handleConfirmDelete(systemId, selectedEnvironment)}
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
            {`Are you sure you want to delete the template "${template.deletingTemplate?.name}"?`}
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

      <AggregatedSloDialog
        open={aggregatedSloDialogOpen}
        onClose={() => {
          setAggregatedSloDialogOpen(false);
          setSelectedAggregatedBenchmark(null);
        }}
        onSuccess={() => {
          setAggregatedSloDialogOpen(false);
          setSelectedAggregatedBenchmark(null);
          slo.fetchBenchmarks(systemId, selectedEnvironment, selectedWorkload);
        }}
        systemUnderTestId={systemId}
        systemName={system.name}
        testEnvironment={selectedEnvironment}
        workload={selectedWorkload}
        existingBenchmark={selectedAggregatedBenchmark ?? undefined}
      />

      <DeleteSystemDialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        systemId={systemId}
        systemName={system.name}
      />

      <ExportSystemDialog
        open={exportDialogOpen}
        onClose={() => setExportDialogOpen(false)}
        systemId={systemId}
        systemName={system.name}
      />
    </Box>
  );
}
