'use client';

import { useState, useEffect } from 'react';
import {
  Box,
  Container,
  Typography,
  Grid,
  Card,
  CardContent,
  Button,
  Skeleton,
  Snackbar,
} from '@mui/material';
import {
  Timeline,
  LocalFireDepartment,
  Speed,
  Add,
  Business,
} from '@mui/icons-material';
import { useOrganizationContext } from '@/lib/contexts/organization-context';
import { NoOrganizationMembership } from '@/components/NoOrganizationMembership';
import { NoOrganizationsExist } from '@/components/NoOrganizationsExist';
import { authenticatedFetch } from '@/lib/api';
import { GrafanaInstance } from '@/lib/grafana-instances';
import { DynatraceConfig } from '@/lib/dynatrace';
import { PyroscopeInstance } from '@/lib/pyroscope';
import { TracingInstance } from '@/lib/distributed-tracing';

// Types
import {
  IntegrationCard,
  SnackbarState,
  IntegrationType,
  INTEGRATION_COLORS,
  INTEGRATION_CATEGORIES,
} from './types';

// Hooks
import {
  useGrafanaIntegration,
  useDynatraceIntegration,
  usePyroscopeIntegration,
  useTracingIntegration,
} from './hooks';

// Components
import {
  GrafanaFormDialog,
  GrafanaDeleteDialog,
  DynatraceFormDialog,
  DynatraceDeleteDialog,
  PyroscopeFormDialog,
  PyroscopeDeleteDialog,
  TracingFormDialog,
  TracingDeleteDialog,
  AddIntegrationDialog,
  IntegrationCardComponent,
} from './components';

export default function IntegrationsPage() {
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [addIntegrationDialogOpen, setAddIntegrationDialogOpen] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [proxyConfigured, setProxyConfigured] = useState(false);
  const [snackbar, setSnackbar] = useState<SnackbarState>({
    open: false,
    message: '',
    severity: 'success',
  });
  const { currentOrganizationId, isReady, isSelectorReadOnly, hasNoOrganizations, isAdmin, organizations } = useOrganizationContext();

  const handleSnackbar = (state: SnackbarState) => setSnackbar(state);

  // Integration hooks
  const grafana = useGrafanaIntegration({ onSnackbar: handleSnackbar, organizationId: currentOrganizationId });
  const dynatrace = useDynatraceIntegration({ onSnackbar: handleSnackbar, organizationId: currentOrganizationId });
  const pyroscope = usePyroscopeIntegration({ onSnackbar: handleSnackbar, organizationId: currentOrganizationId });
  const tracing = useTracingIntegration({ onSnackbar: handleSnackbar, organizationId: currentOrganizationId });

  // Load all data on mount and when organization changes
  useEffect(() => {
    if (!isSelectorReadOnly && !isReady) return;
    const loadData = async () => {
      setInitialLoading(true);
      await Promise.all([
        grafana.loadInstances(),
        dynatrace.loadConfigs(),
        pyroscope.loadInstances(),
        tracing.loadInstances(),
        authenticatedFetch('/proxy').then(r => r.ok ? r.json() : null).then(data => {
          setProxyConfigured(data != null);
        }).catch(() => setProxyConfigured(false)),
      ]);
      setInitialLoading(false);
    };
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOrganizationId, isReady]);

  /**
   * Flatten integration instances into individual cards
   */
  const flattenIntegrationCards = (): IntegrationCard[] => {
    const cards: IntegrationCard[] = [];

    // Grafana instances
    grafana.instances.forEach((instance) => {
      cards.push({
        id: `grafana-${instance.id}`,
        integrationType: 'grafana',
        name: instance.label,
        tldr: (() => {
          try {
            const hostname = new URL(instance.clientUrl).hostname;
            return `${hostname} • Org ${instance.orgId} • ${instance.snapshotInstance ? 'Snapshot Instance' : 'Regular Instance'}`;
          } catch {
            return `${instance.clientUrl} • Org ${instance.orgId}`;
          }
        })(),
        category: INTEGRATION_CATEGORIES.grafana,
        status: 'connected',
        icon: <Timeline />,
        color: INTEGRATION_COLORS.grafana,
        instanceData: instance,
      });
    });

    // Dynatrace configs
    dynatrace.configs.forEach((config) => {
      const hostname = (() => {
        try {
          return new URL(config.host).hostname;
        } catch {
          return config.host;
        }
      })();

      cards.push({
        id: `dynatrace-${config.id}`,
        integrationType: 'dynatrace',
        name: config.label || hostname,
        tldr: `${hostname} • ${config.dynatraceType.toUpperCase()} • ${(config.perfanaTestRunIdAttribute || config.perfanaRequestNameAttribute) ? 'Attributes Configured' : 'Basic Configuration'}`,
        category: INTEGRATION_CATEGORIES.dynatrace,
        status: 'connected',
        icon: <Speed />,
        color: INTEGRATION_COLORS.dynatrace,
        instanceData: config,
      });
    });

    // Pyroscope instances
    pyroscope.instances.forEach((instance) => {
      const hostname = (() => {
        try {
          return new URL(instance.pyroscopeUrl).hostname;
        } catch {
          return instance.pyroscopeUrl;
        }
      })();

      cards.push({
        id: `pyroscope-${instance.id}`,
        integrationType: 'pyroscope',
        name: instance.label,
        tldr: `${hostname} • ${instance.pyroscopeStandAlone ? 'Standalone Pyroscope' : 'Grafana Pyroscope App'}`,
        category: INTEGRATION_CATEGORIES.pyroscope,
        status: 'connected',
        icon: <LocalFireDepartment />,
        color: INTEGRATION_COLORS.pyroscope,
        instanceData: instance,
      });
    });

    // Tracing instances
    tracing.instances.forEach((instance) => {
      const hostname = (() => {
        try {
          return new URL(instance.tracing_url).hostname;
        } catch {
          return instance.tracing_url;
        }
      })();

      const uiLabel = (() => {
        switch (instance.tracing_ui) {
          case 'tempo':
            return 'Grafana Tempo';
          case 'jaeger':
            return 'Jaeger';
          case 'elastic':
            return 'Elastic APM';
          default:
            return instance.tracing_ui;
        }
      })();

      cards.push({
        id: `tracing-${instance.id}`,
        integrationType: 'tracing',
        name: instance.label,
        tldr: `${hostname} • ${uiLabel} • ${instance.tracing_iframe_allowed ? 'Iframe Enabled' : 'External Link'}`,
        category: INTEGRATION_CATEGORIES.tracing,
        status: 'connected',
        icon: <Timeline />,
        color: INTEGRATION_COLORS.tracing,
        instanceData: instance,
      });
    });

    return cards;
  };

  const integrationCards = flattenIntegrationCards();

  const toggleCardExpanded = (cardId: string) => {
    const wasCollapsed = !expandedCards.has(cardId);
    const newExpandedCards = new Set(expandedCards);
    if (newExpandedCards.has(cardId)) {
      newExpandedCards.delete(cardId);
    } else {
      newExpandedCards.add(cardId);
    }
    setExpandedCards(newExpandedCards);

    // Auto-focus behavior when expanding
    if (wasCollapsed) {
      setTimeout(() => {
        const expandedCard = document.querySelector(`[data-card-id="${cardId}"]`);
        if (expandedCard) {
          expandedCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
          (expandedCard as HTMLElement).focus({ preventScroll: true });
        }
      }, 300);
    }
  };

  const handleSettingsClick = (card: IntegrationCard) => {
    if (card.integrationType === 'grafana' && card.instanceData) {
      grafana.openEditDialog(card.instanceData as GrafanaInstance);
    } else if (card.integrationType === 'dynatrace' && card.instanceData) {
      dynatrace.openEditDialog(card.instanceData as DynatraceConfig);
    } else if (card.integrationType === 'pyroscope' && card.instanceData) {
      pyroscope.openEditDialog(card.instanceData as PyroscopeInstance);
    } else if (card.integrationType === 'tracing' && card.instanceData) {
      tracing.openEditDialog(card.instanceData as TracingInstance);
    }
  };

  const handleDeleteClick = (card: IntegrationCard) => {
    if (card.integrationType === 'grafana' && card.instanceData) {
      grafana.openDeleteDialog(card.instanceData as GrafanaInstance);
    } else if (card.integrationType === 'dynatrace' && card.instanceData) {
      dynatrace.openDeleteDialog(card.instanceData as DynatraceConfig);
    } else if (card.integrationType === 'pyroscope' && card.instanceData) {
      pyroscope.openDeleteDialog(card.instanceData as PyroscopeInstance);
    } else if (card.integrationType === 'tracing' && card.instanceData) {
      tracing.openDeleteDialog(card.instanceData as TracingInstance);
    }
  };

  const handleConnectClick = (integrationType: IntegrationType) => {
    if (integrationType === 'grafana') {
      grafana.setCreateDialogOpen(true);
    } else if (integrationType === 'dynatrace') {
      dynatrace.setCreateDialogOpen(true);
    } else if (integrationType === 'pyroscope') {
      pyroscope.setCreateDialogOpen(true);
    } else if (integrationType === 'tracing') {
      tracing.setCreateDialogOpen(true);
    }
  };

  const handleAddIntegrationSelect = (integrationType: IntegrationType) => {
    handleConnectClick(integrationType);
  };

  if (hasNoOrganizations) {
    return <NoOrganizationMembership />;
  }

  if (isAdmin && !isReady && organizations.length === 0) {
    return <NoOrganizationsExist />;
  }

  // Show prompt if org selection is required but not yet made
  if (!isSelectorReadOnly && !isReady) {
    return (
      <Box sx={{ display: 'flex', minHeight: '60vh', alignItems: 'center', justifyContent: 'center' }}>
        <Box sx={{ textAlign: 'center' }}>
          <Business sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>
            Select an organization
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Choose an organization from the sidebar to view integrations.
          </Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Container maxWidth="xl">
      {/* Header */}
      <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Box>
          <Typography variant="h4" fontWeight="bold" gutterBottom>
            Integrations
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Connect your performance testing tools and observability platforms
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => setAddIntegrationDialogOpen(true)}
          sx={{ mt: 0.5 }}
        >
          Add Integration
        </Button>
      </Box>

      {/* Loading State */}
      {initialLoading ? (
        <Grid container spacing={3}>
          {[1, 2, 3, 4].map((i) => (
            <Grid size={{ xs: 12, sm: 6, md: 4 }} key={i}>
              <Card sx={{ minHeight: 200 }}>
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                    <Skeleton variant="circular" width={32} height={32} sx={{ mr: 2 }} />
                    <Box sx={{ flex: 1 }}>
                      <Skeleton variant="text" width="60%" height={28} />
                      <Skeleton variant="text" width="40%" height={20} />
                    </Box>
                  </Box>
                  <Skeleton variant="text" width="100%" />
                  <Skeleton variant="text" width="80%" />
                  <Skeleton variant="text" width="90%" sx={{ mt: 1 }} />
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      ) : (
        /* Integration Cards */
        <Grid container spacing={3} sx={{ alignItems: 'stretch' }}>
          {integrationCards.map((card) => {
            const isExpanded = expandedCards.has(card.id);
            const isGrafanaInstance = card.integrationType === 'grafana' && card.instanceData;
            const shouldSpanFullWidth = isExpanded && isGrafanaInstance;

            return (
              <Grid
                size={shouldSpanFullWidth ? { xs: 12 } : { xs: 12, sm: 6, md: 4 }}
                key={card.id}
                sx={{ display: 'flex' }}
              >
                <IntegrationCardComponent
                  card={card}
                  isExpanded={isExpanded}
                  onToggleExpand={() => toggleCardExpanded(card.id)}
                  onSettings={() => handleSettingsClick(card)}
                  onDelete={() => handleDeleteClick(card)}
                  onConnect={() => handleConnectClick(card.integrationType)}
                  onSnackbar={(message, severity) => setSnackbar({ open: true, message, severity })}
                />
              </Grid>
            );
          })}
        </Grid>
      )}

      {/* Grafana Dialogs */}
      <GrafanaFormDialog
        open={grafana.createDialogOpen || grafana.editDialogOpen}
        isEdit={grafana.editDialogOpen}
        form={grafana.form}
        visiblePasswords={grafana.visiblePasswords}
        testingConnection={grafana.testingConnection}
        proxyConfigured={proxyConfigured}
        onClose={grafana.closeDialogs}
        onSubmit={grafana.editDialogOpen ? grafana.handleUpdate : grafana.handleCreate}
        onTestConnection={grafana.handleTestConnection}
        onTogglePasswordVisibility={grafana.togglePasswordVisibility}
      />
      <GrafanaDeleteDialog
        open={grafana.deleteDialogOpen}
        instance={grafana.selectedInstance}
        onClose={() => grafana.setDeleteDialogOpen(false)}
        onConfirm={grafana.handleDelete}
      />

      {/* Dynatrace Dialogs */}
      <DynatraceFormDialog
        open={dynatrace.createDialogOpen || dynatrace.editDialogOpen}
        isEdit={dynatrace.editDialogOpen}
        form={dynatrace.form}
        testingConnection={dynatrace.testingConnection}
        requestAttributes={dynatrace.requestAttributes}
        loadingAttributes={dynatrace.loadingAttributes}
        selectedTestRunIdAttribute={dynatrace.selectedTestRunIdAttribute}
        selectedRequestNameAttribute={dynatrace.selectedRequestNameAttribute}
        proxyConfigured={proxyConfigured}
        onClose={dynatrace.closeDialogs}
        onSubmit={dynatrace.editDialogOpen ? dynatrace.handleUpdate : dynatrace.handleCreate}
        onTestConnection={dynatrace.handleTestConnection}
        onTestRunIdAttributeChange={dynatrace.setSelectedTestRunIdAttribute}
        onRequestNameAttributeChange={dynatrace.setSelectedRequestNameAttribute}
      />
      <DynatraceDeleteDialog
        open={dynatrace.deleteDialogOpen}
        config={dynatrace.selectedConfig}
        onClose={() => dynatrace.setDeleteDialogOpen(false)}
        onConfirm={dynatrace.handleDelete}
      />

      {/* Pyroscope Dialogs */}
      <PyroscopeFormDialog
        open={pyroscope.createDialogOpen || pyroscope.editDialogOpen}
        isEdit={pyroscope.editDialogOpen}
        form={pyroscope.form}
        testingConnection={pyroscope.testingConnection}
        proxyConfigured={proxyConfigured}
        onClose={pyroscope.closeDialogs}
        onSubmit={pyroscope.editDialogOpen ? pyroscope.handleUpdate : pyroscope.handleCreate}
        onTestConnection={pyroscope.handleTestConnection}
      />
      <PyroscopeDeleteDialog
        open={pyroscope.deleteDialogOpen}
        instance={pyroscope.selectedInstance}
        onClose={() => pyroscope.setDeleteDialogOpen(false)}
        onConfirm={pyroscope.handleDelete}
      />

      {/* Tracing Dialogs */}
      <TracingFormDialog
        open={tracing.createDialogOpen || tracing.editDialogOpen}
        isEdit={tracing.editDialogOpen}
        form={tracing.form}
        testingConnection={tracing.testingConnection}
        proxyConfigured={proxyConfigured}
        onClose={tracing.closeDialogs}
        onSubmit={tracing.editDialogOpen ? tracing.handleUpdate : tracing.handleCreate}
        onTestConnection={tracing.handleTestConnection}
      />
      <TracingDeleteDialog
        open={tracing.deleteDialogOpen}
        instance={tracing.selectedInstance}
        onClose={() => tracing.setDeleteDialogOpen(false)}
        onConfirm={tracing.handleDelete}
      />

      {/* Add Integration Dialog */}
      <AddIntegrationDialog
        open={addIntegrationDialogOpen}
        onClose={() => setAddIntegrationDialogOpen(false)}
        onSelect={handleAddIntegrationSelect}
      />

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        message={snackbar.message}
      />
    </Container>
  );
}
