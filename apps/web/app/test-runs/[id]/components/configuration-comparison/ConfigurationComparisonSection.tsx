'use client';

import React, { useRef } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  IconButton,
  Collapse,
} from '@mui/material';
import { ExpandMore, ExpandLess } from '@mui/icons-material';

// Types
import { ConfigurationComparisonSectionProps } from './types';

// Hooks
import { useConfigComparison } from './hooks';

// Components
import { ConfigDiffTable, ConfigCollapsedView, ConfigFilterControls } from './components';

export default function ConfigurationComparisonSection({
  testRun,
  testRunId,
  configExpanded,
  onConfigExpand,
  showToast,
}: ConfigurationComparisonSectionProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  // Data hook
  const configData = useConfigComparison({
    testRun,
    testRunId,
    configExpanded,
    showToast,
  });

  // Handle expand/collapse
  const handleConfigExpand = () => {
    const wasCollapsed = !configExpanded;
    onConfigExpand();

    if (wasCollapsed) {
      setTimeout(() => {
        const expandedCard = document.querySelector('[data-testid="config-comparison-section-expanded"]');
        if (expandedCard) {
          (expandedCard as HTMLElement).focus({ preventScroll: true });
        }
      }, 300);
    }

    if (!configExpanded) {
      if (configData.testRunConfigs.length === 0) {
        configData.loadTestRunConfigs(testRunId);
      }
      if (configData.relatedTestRuns.length === 0) {
        configData.loadRelatedTestRuns(testRunId);
      }
    }
  };

  return (
    <Box sx={{
      ...(configExpanded ? { flex: '1 1 100% !important', minWidth: 'unset' } : {})
    }}>
      <Card
        ref={cardRef}
        tabIndex={-1}
        elevation={0}
        data-testid={configExpanded ? 'config-comparison-section-expanded' : 'config-comparison-section-collapsed'}
        sx={{
          cursor: configExpanded ? 'default' : 'pointer',
          height: configExpanded ? 'auto' : '293px',
          borderRadius: 3,
          bgcolor: 'background.paper',
          border: configExpanded ? '1px solid' : 'none',
          borderColor: configExpanded ? 'divider' : undefined,
          borderTop: configExpanded ? undefined : `3px solid ${configData.accentColor}`,
          boxShadow: (theme) => configExpanded
            ? theme.palette.mode === 'dark'
              ? '0 4px 12px rgba(0, 0, 0, 0.2), 0 2px 4px rgba(0, 0, 0, 0.15)'
              : '0 4px 12px rgba(0, 0, 0, 0.05), 0 2px 4px rgba(0, 0, 0, 0.02)'
            : theme.palette.mode === 'dark'
              ? '0 1px 3px rgba(0, 0, 0, 0.3), 0 4px 12px rgba(0, 0, 0, 0.2)'
              : '0 1px 3px rgba(0, 0, 0, 0.08), 0 4px 12px rgba(0, 0, 0, 0.04)',
          transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          position: 'relative',
          overflow: configExpanded ? 'visible' : 'hidden',
          '&:hover': configExpanded ? {} : {
            transform: 'translateY(-4px)',
            boxShadow: (theme) => theme.palette.mode === 'dark'
              ? '0 4px 12px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.3)'
              : '0 4px 12px rgba(0, 0, 0, 0.1), 0 8px 24px rgba(0, 0, 0, 0.08)',
          }
        }}
        onClick={configExpanded ? undefined : handleConfigExpand}
      >
        <CardContent sx={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          p: 3,
          '&:last-child': { pb: 3 }
        }}>
          {/* Header Section */}
          <Box
            display="flex"
            justifyContent="center"
            alignItems="center"
            mb={configExpanded ? 3 : 2}
            sx={{
              cursor: configExpanded ? 'pointer' : 'inherit',
              py: configExpanded ? 1 : 0,
              px: configExpanded ? 1 : 0,
              mx: configExpanded ? -1 : 0,
              borderRadius: 2,
              transition: 'all 0.2s ease',
              gap: 2,
              ...(configExpanded ? {
                position: 'sticky',
                top: 0,
                zIndex: 10,
                bgcolor: 'background.paper',
                borderBottom: '1px solid',
                borderColor: 'divider',
              } : {
                position: 'relative',
              }),
              '&:hover': configExpanded ? { backgroundColor: 'action.hover' } : {}
            }}
            onClick={configExpanded ? handleConfigExpand : undefined}
          >
            <Box textAlign="center">
              <Typography
                variant={configExpanded ? "h5" : "subtitle1"}
                component="h2"
                sx={{
                  fontWeight: 600,
                  color: configExpanded ? 'text.primary' : 'text.secondary',
                  fontSize: configExpanded ? '1.125rem' : '0.875rem',
                  letterSpacing: '0.01em',
                  textTransform: configExpanded ? 'none' : 'uppercase',
                  textAlign: 'center',
                }}
              >
                Environment Configuration
              </Typography>
              {configExpanded && (
                <Typography variant="body2" color="text.secondary">
                  Click to collapse
                </Typography>
              )}
            </Box>
            <IconButton
              onClick={(e) => {
                e.stopPropagation();
                handleConfigExpand();
              }}
              size="small"
              sx={{
                position: 'absolute',
                right: 0,
                width: 32,
                height: 32,
                color: 'text.secondary',
                backgroundColor: configExpanded ? 'action.hover' : 'transparent',
                '&:hover': {
                  backgroundColor: `${configData.accentColor}15`,
                  color: configData.accentColor,
                },
                transition: 'all 0.2s ease',
              }}
            >
              {configExpanded ? <ExpandLess /> : <ExpandMore />}
            </IconButton>
          </Box>

          {/* Collapsed View */}
          {!configExpanded && (
            <ConfigCollapsedView
              configLoading={configData.configLoading}
              configComparisons={configData.configComparisons}
              selectedRelatedTestRun={configData.selectedRelatedTestRun}
              testRunConfigs={configData.testRunConfigs}
            />
          )}

          {/* Expanded Content */}
          <Collapse in={configExpanded}>
            <Divider sx={{ my: 2 }} />

            <ConfigFilterControls
              relatedTestRuns={configData.relatedTestRuns}
              selectedRelatedTestRun={configData.selectedRelatedTestRun}
              selectedConfigLoading={configData.selectedConfigLoading}
              onRelatedTestRunChange={configData.handleRelatedTestRunChange}
              allTags={configData.allTags}
              selectedTags={configData.selectedTags}
              onTagsChange={configData.setSelectedTags}
              keyFilter={configData.keyFilter}
              onKeyFilterChange={configData.setKeyFilter}
              statusFilters={configData.statusFilters}
              onStatusFiltersChange={configData.setStatusFilters}
              configComparisons={configData.configComparisons}
              filteredComparisons={configData.filteredComparisons}
              configLoading={configData.configLoading}
            />

            {configData.configLoading ? (
              <Box display="flex" justifyContent="center" py={2}>
                <CircularProgress size={24} />
              </Box>
            ) : configData.filteredComparisons.length > 0 ? (
              <ConfigDiffTable
                comparisons={configData.filteredComparisons}
                selectedRelatedTestRun={configData.selectedRelatedTestRun}
                testRunConfigs={configData.testRunConfigs}
                expectedChangesLoading={configData.expectedChangesLoading}
                onToggleExpectedChange={configData.toggleExpectedConfigChange}
              />
            ) : (
              <Box textAlign="center" py={4}>
                <Typography variant="body2" color="text.secondary">
                  {configData.testRunConfigs.length === 0
                    ? "No configuration items found for this test run."
                    : configData.configComparisons.length === 0
                      ? "No configuration comparisons available."
                      : "No configuration items match the selected filters."}
                </Typography>
                {configData.filteredComparisons.length === 0 && configData.configComparisons.length > 0 && (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    Try selecting different status filters or clearing all filters.
                  </Typography>
                )}
              </Box>
            )}
          </Collapse>
        </CardContent>
      </Card>
    </Box>
  );
}
