'use client';

import React, { useRef } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  IconButton,
  Collapse,
  Divider,
} from '@mui/material';
import {
  ExpandMore,
  ExpandLess,
  Settings,
} from '@mui/icons-material';
import { useThemeMode } from '@/contexts/theme-context';

// Types
import { DashboardsSectionProps } from './types';

// Hooks
import { useDashboardsData } from './hooks';

// Utils
import { buildGrafanaNewTabUrl } from './utils';

// Components
import {
  DashboardsCollapsedView,
  DashboardsExpandedContent,
  DashboardDialog,
} from './components';

export default function DashboardsSection({
  testRun,
  testRunId,
  dashboardsExpanded,
  onDashboardsExpand,
}: DashboardsSectionProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const { mode } = useThemeMode();

  // Data hook
  const dashboardsData = useDashboardsData({
    testRun,
    testRunId,
    dashboardsExpanded,
    onDashboardsExpand,
  });

  // Handle open in Grafana
  const handleOpenInGrafana = (dashboard: typeof dashboardsData.dashboards[0]) => {
    const url = buildGrafanaNewTabUrl(dashboard, testRun, mode);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <>
      <Box sx={{
        ...(dashboardsExpanded ? {
          flex: '1 1 100% !important',
          minWidth: 'unset'
        } : {})
      }}>
        <Card
          ref={cardRef}
          tabIndex={-1}
          elevation={0}
          data-testid={dashboardsExpanded ? 'dashboards-section-expanded' : 'dashboards-section-collapsed'}
          sx={{
            cursor: dashboardsExpanded ? 'default' : 'pointer',
            height: dashboardsExpanded ? 'auto' : '293px',
            borderRadius: 3,
            bgcolor: 'background.paper',
            border: 'none',
            borderTop: dashboardsExpanded ? 'none' : '3px solid',
            borderTopColor: dashboardsExpanded ? 'transparent' : 'primary.main',
            boxShadow: (theme) => theme.palette.mode === 'dark'
              ? '0 1px 3px rgba(0, 0, 0, 0.3), 0 4px 12px rgba(0, 0, 0, 0.2)'
              : '0 1px 3px rgba(0, 0, 0, 0.08), 0 4px 12px rgba(0, 0, 0, 0.04)',
            transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
            position: 'relative',
            overflow: dashboardsExpanded ? 'visible' : 'hidden',
            '&:hover': dashboardsExpanded ? {} : {
              transform: 'translateY(-4px)',
              boxShadow: (theme) => theme.palette.mode === 'dark'
                ? '0 4px 12px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.3)'
                : '0 4px 12px rgba(0, 0, 0, 0.1), 0 8px 24px rgba(0, 0, 0, 0.08)'
            }
          }}
          onClick={dashboardsExpanded ? undefined : () => dashboardsData.handleDashboardsExpand()}
        >
          <CardContent sx={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            p: dashboardsExpanded ? 2 : 3.5,
            pt: dashboardsExpanded ? 2 : 4,
            gap: dashboardsExpanded ? 3 : 0,
            '&:last-child': { pb: dashboardsExpanded ? 2 : 3.5 }
          }}>
            {/* Header Section */}
            <Box
              display="flex"
              justifyContent="center"
              alignItems="center"
              mb={dashboardsExpanded ? 0 : 2}
              sx={{
                cursor: dashboardsExpanded ? 'pointer' : 'inherit',
                py: dashboardsExpanded ? 1 : 0,
                px: dashboardsExpanded ? 1.25 : 0,
                mx: dashboardsExpanded ? -1.25 : 0,
                borderRadius: 2,
                transition: 'all 0.2s ease',
                ...(dashboardsExpanded ? {
                  position: 'sticky',
                  top: 0,
                  zIndex: 10,
                  bgcolor: 'background.paper',
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                } : {
                  position: 'relative',
                }),
                '&:hover': dashboardsExpanded ? {
                  backgroundColor: 'action.hover'
                } : {}
              }}
              onClick={dashboardsExpanded ? () => dashboardsData.handleDashboardsExpand() : undefined}
            >
              {dashboardsExpanded ? (
                <Box textAlign="center" flex="1">
                  <Typography
                    variant="h5"
                    component="h2"
                    sx={{
                      fontWeight: 600,
                      color: 'text.primary',
                      fontSize: '1.25rem',
                      lineHeight: 1.2
                    }}
                  >
                    Grafana Dashboards
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Click to collapse
                  </Typography>
                </Box>
              ) : (
                <Typography
                  variant="subtitle1"
                  component="h2"
                  sx={{
                    fontWeight: 600,
                    color: 'text.secondary',
                    fontSize: '0.875rem',
                    letterSpacing: '0.01em',
                    textTransform: 'uppercase',
                    textAlign: 'center',
                  }}
                >
                  Grafana Dashboards
                </Typography>
              )}
              <Box
                display="flex"
                alignItems="center"
                gap={1}
                sx={{
                  position: dashboardsExpanded ? 'relative' : 'absolute',
                  right: dashboardsExpanded ? 'auto' : 0,
                }}
              >
                {dashboardsExpanded && (
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (testRun) {
                        const configUrl = `/systems/${testRun.system_under_test_id}/config?tab=grafana&environment=${encodeURIComponent(testRun.test_environment)}&workload=${encodeURIComponent(testRun.workload || '')}`;
                        window.open(configUrl, '_blank');
                      }
                    }}
                    aria-label="dashboard settings"
                    title="Open system configuration in new tab"
                    sx={{
                      '&:hover': {
                        backgroundColor: 'action.hover'
                      }
                    }}
                  >
                    <Settings fontSize="small" />
                  </IconButton>
                )}
                <IconButton
                  onClick={(e) => {
                    e.stopPropagation();
                    dashboardsData.handleDashboardsExpand();
                  }}
                  size="small"
                  sx={{
                    width: 32,
                    height: 32,
                    color: 'text.secondary',
                    '&:hover': {
                      backgroundColor: (theme) => `${theme.palette.primary.main}26`,
                      color: 'primary.main',
                    },
                    transition: 'all 0.2s ease',
                  }}
                >
                  {dashboardsExpanded ? <ExpandLess /> : <ExpandMore />}
                </IconButton>
              </Box>
            </Box>

            {/* Collapsed View */}
            {!dashboardsExpanded && (
              <DashboardsCollapsedView
                dashboards={dashboardsData.dashboards}
                dashboardsLoading={dashboardsData.dashboardsLoading}
                onTagClick={(tag) => dashboardsData.handleDashboardsExpand(tag)}
              />
            )}

            {/* Expanded Content */}
            <Collapse in={dashboardsExpanded}>
              <Divider sx={{ my: 2 }} />
              <DashboardsExpandedContent
                dashboards={dashboardsData.dashboards}
                filteredDashboards={dashboardsData.filteredDashboards}
                dashboardsLoading={dashboardsData.dashboardsLoading}
                allDashboardTags={dashboardsData.allDashboardTags}
                selectedDashboardTags={dashboardsData.selectedDashboardTags}
                dashboardSearchText={dashboardsData.dashboardSearchText}
                systemName={testRun?.systems_under_test?.name}
                testEnvironment={testRun?.test_environment}
                onSearchChange={dashboardsData.setDashboardSearchText}
                onTagToggle={dashboardsData.toggleTagSelection}
                onViewDashboard={dashboardsData.handleOpenDashboard}
                onOpenInGrafana={handleOpenInGrafana}
              />
            </Collapse>
          </CardContent>
        </Card>
      </Box>

      {/* Dashboard Dialog */}
      <DashboardDialog
        dashboard={dashboardsData.expandedDashboard}
        dashboards={dashboardsData.dashboards}
        onClose={dashboardsData.handleCloseDashboard}
        buildGrafanaIframeUrl={dashboardsData.buildGrafanaIframeUrl}
      />
    </>
  );
}
