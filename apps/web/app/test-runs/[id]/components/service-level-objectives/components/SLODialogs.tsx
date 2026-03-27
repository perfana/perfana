'use client';

import React from 'react';
import {
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
} from '@mui/material';
import {
  Settings,
  AccountTree as AccountTreeIcon,
  Insights as InsightsIcon,
} from '@mui/icons-material';
import { TestRun } from '@/types/test-runs';
import EditSLODialog from '@/app/systems/[id]/config/components/EditSLODialog';
import ApdexConfigDialog from '../../performance-analysis/ApdexConfigDialog';
import ApdexThresholdsManagementDialog from '../ApdexThresholdsManagementDialog';
import { DrillDownFilters } from '../types/slo.types';
import {
  RequestActionMenuData,
  ApdexActionMenuData,
  TransactionForApdex,
} from '../hooks/useSLOSection';

export interface SLODialogsProps {
  testRun: TestRun | null;
  testRunId: string;
  hasDistributedTracing: boolean;
  hasDynatrace: boolean;
  onDrillDownToDistributedTracing?: (filters: DrillDownFilters) => void;
  onDrillDownToDynatrace?: (filters: DrillDownFilters) => void;

  // Edit SLO dialog
  editSloDialogOpen: boolean;
  selectedSloForEdit: any;
  setEditSloDialogOpen: (open: boolean) => void;
  setSelectedSloForEdit: (slo: any) => void;
  handleSloUpdated: (updatedSlo: any) => void;

  // Apdex action menu
  apdexActionMenuAnchor: HTMLElement | null;
  apdexActionMenuData: ApdexActionMenuData | null;
  handleCloseApdexActionMenu: () => void;
  setSelectedTransactionForApdex: (data: TransactionForApdex | null) => void;
  setApdexConfigDialogOpen: (open: boolean) => void;

  // Request action menu
  requestActionMenuAnchor: HTMLElement | null;
  requestActionMenuData: RequestActionMenuData | null;
  handleCloseRequestActionMenu: () => void;

  // Apdex config dialog
  apdexConfigDialogOpen: boolean;
  selectedTransactionForApdex: TransactionForApdex | null;
  handleApdexConfigSuccess: () => void;

  // Apdex thresholds dialog
  apdexThresholdsDialogOpen: boolean;
  selectedApdexResultForThresholds: any;
  setApdexThresholdsDialogOpen: (open: boolean) => void;
  setSelectedApdexResultForThresholds: (result: any) => void;
  handleApdexThresholdsSuccess: () => void;
}

export default function SLODialogs({
  testRun,
  testRunId,
  hasDistributedTracing,
  hasDynatrace,
  onDrillDownToDistributedTracing,
  onDrillDownToDynatrace,
  editSloDialogOpen,
  selectedSloForEdit,
  setEditSloDialogOpen,
  setSelectedSloForEdit,
  handleSloUpdated,
  apdexActionMenuAnchor,
  apdexActionMenuData,
  handleCloseApdexActionMenu,
  setSelectedTransactionForApdex,
  setApdexConfigDialogOpen,
  requestActionMenuAnchor,
  requestActionMenuData,
  handleCloseRequestActionMenu,
  apdexConfigDialogOpen,
  selectedTransactionForApdex,
  handleApdexConfigSuccess,
  apdexThresholdsDialogOpen,
  selectedApdexResultForThresholds,
  setApdexThresholdsDialogOpen,
  setSelectedApdexResultForThresholds,
  handleApdexThresholdsSuccess,
}: SLODialogsProps) {
  return (
    <>
      {/* Edit SLO Dialog */}
      {testRun && selectedSloForEdit && (
        <EditSLODialog
          open={editSloDialogOpen}
          onClose={() => {
            setEditSloDialogOpen(false);
            setSelectedSloForEdit(null);
          }}
          benchmark={selectedSloForEdit}
          systemId={testRun.system_under_test_id}
          systemName={testRun.system_under_test?.name || testRun.systems_under_test?.name || testRun.system_under_test_id}
          environment={testRun.test_environment}
          workload={testRun.workload}
          onSLOUpdated={handleSloUpdated}
        />
      )}

      {/* Apdex Transaction Action Menu */}
      <Menu
        anchorEl={apdexActionMenuAnchor}
        open={Boolean(apdexActionMenuAnchor)}
        onClose={handleCloseApdexActionMenu}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
      >
        <MenuItem onClick={() => {
          if (apdexActionMenuData) {
            setSelectedTransactionForApdex({
              transactionName: apdexActionMenuData.transactionName,
              currentThreshold: apdexActionMenuData.threshold
            });
            setApdexConfigDialogOpen(true);
          }
          handleCloseApdexActionMenu();
        }}>
          <ListItemIcon>
            <Settings fontSize="small" />
          </ListItemIcon>
          <ListItemText>Configure Apdex Threshold</ListItemText>
        </MenuItem>
        {hasDistributedTracing && onDrillDownToDistributedTracing && (
          <MenuItem onClick={() => {
            if (apdexActionMenuData) {
              onDrillDownToDistributedTracing({
                scenario: apdexActionMenuData.scenarioName,
                transaction: apdexActionMenuData.transactionName,
              });
            }
            handleCloseApdexActionMenu();
          }}>
            <ListItemIcon>
              <AccountTreeIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>View in Distributed Traces</ListItemText>
          </MenuItem>
        )}
        {hasDynatrace && onDrillDownToDynatrace && (
          <MenuItem onClick={() => {
            if (apdexActionMenuData) {
              onDrillDownToDynatrace({
                scenario: apdexActionMenuData.scenarioName,
                transaction: apdexActionMenuData.transactionName,
              });
            }
            handleCloseApdexActionMenu();
          }}>
            <ListItemIcon>
              <InsightsIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>View in Dynatrace</ListItemText>
          </MenuItem>
        )}
      </Menu>

      {/* Request Action Menu (for requests breakdown in Apdex SLOs) */}
      <Menu
        anchorEl={requestActionMenuAnchor}
        open={Boolean(requestActionMenuAnchor)}
        onClose={handleCloseRequestActionMenu}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
      >
        {hasDistributedTracing && onDrillDownToDistributedTracing && (
          <MenuItem onClick={() => {
            if (requestActionMenuData) {
              onDrillDownToDistributedTracing({
                scenario: requestActionMenuData.scenarioName,
                transaction: requestActionMenuData.transactionName,
                sampler: requestActionMenuData.samplerName,
              });
            }
            handleCloseRequestActionMenu();
          }}>
            <ListItemIcon>
              <AccountTreeIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>View in Distributed Traces</ListItemText>
          </MenuItem>
        )}
        {hasDynatrace && onDrillDownToDynatrace && (
          <MenuItem onClick={() => {
            if (requestActionMenuData) {
              onDrillDownToDynatrace({
                scenario: requestActionMenuData.scenarioName,
                transaction: requestActionMenuData.transactionName,
                sampler: requestActionMenuData.samplerName,
              });
            }
            handleCloseRequestActionMenu();
          }}>
            <ListItemIcon>
              <InsightsIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>View in Dynatrace</ListItemText>
          </MenuItem>
        )}
      </Menu>

      {/* Apdex Transaction Threshold Config Dialog */}
      <ApdexConfigDialog
        open={apdexConfigDialogOpen}
        onClose={() => {
          setApdexConfigDialogOpen(false);
          setSelectedTransactionForApdex(null);
        }}
        testRunId={testRunId}
        transactionName={selectedTransactionForApdex?.transactionName}
        currentThreshold={selectedTransactionForApdex?.currentThreshold}
        onSuccess={handleApdexConfigSuccess}
      />

      {/* Apdex Thresholds Management Dialog (opened from cog icon in Apdex SLO row) */}
      <ApdexThresholdsManagementDialog
        open={apdexThresholdsDialogOpen}
        onClose={() => {
          setApdexThresholdsDialogOpen(false);
          setSelectedApdexResultForThresholds(null);
        }}
        testRunId={testRunId}
        apdexCheckResult={selectedApdexResultForThresholds}
        onSuccess={handleApdexThresholdsSuccess}
      />
    </>
  );
}
