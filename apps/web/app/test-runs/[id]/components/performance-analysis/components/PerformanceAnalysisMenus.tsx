'use client';

import {
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
} from '@mui/material';
import {
  Settings as SettingsIcon,
  ShowChart as ShowChartIcon,
  MoreVert as _MoreVertIcon,
  Info as InfoIcon,
  Error as ErrorIcon,
  AccountTree as AccountTreeIcon,
  Insights as InsightsIcon,
  Assessment as AssessmentIcon,
} from '@mui/icons-material';
import { TransactionStat, DrillDownFilters } from '../types/performance-analysis.types';
import { SamplerActionMenuData } from '../hooks/usePerformanceAnalysisHandlers';

interface PerformanceAnalysisMenusProps {
  transactions: TransactionStat[];
  hasDistributedTracing: boolean;
  hasDynatrace: boolean;
  hasExplicitThreshold: boolean;
  onDrillDownToDistributedTracing?: (filters: DrillDownFilters) => void;
  onDrillDownToDynatrace?: (filters: DrillDownFilters) => void;

  // Apdex menu
  apdexMenuAnchor: HTMLElement | null;
  onCloseApdexMenu: () => void;
  onOpenThresholdDialog: () => void;
  onOpenSloDialog: () => void;
  onOpenBaselineDialog: () => void;
  onOpenThresholdsManagementDialog: () => void;

  // Transaction action menu
  actionMenuAnchor: HTMLElement | null;
  actionMenuTransaction: string;
  onCloseActionMenu: () => void;
  onOpenGraphModal: (transactionName: string) => void;
  onConfigureApdex: () => void;
  onShowDetails: () => void;

  // Sampler action menu
  samplerActionMenuAnchor: HTMLElement | null;
  samplerActionMenuData: SamplerActionMenuData | null;
  onCloseSamplerActionMenu: () => void;
  onSetRequestGraphModalData: (data: { transactionName: string; samplerName: string }) => void;
  onSetRequestGraphModalOpen: (open: boolean) => void;
  onShowSamplerDetails: () => void;
  onOpenSamplerErrors: (transactionName: string, samplerName: string) => void;
}

export function PerformanceAnalysisMenus({
  transactions,
  hasDistributedTracing,
  hasDynatrace,
  hasExplicitThreshold,
  onDrillDownToDistributedTracing,
  onDrillDownToDynatrace,
  apdexMenuAnchor,
  onCloseApdexMenu,
  onOpenThresholdDialog,
  onOpenSloDialog,
  onOpenBaselineDialog,
  onOpenThresholdsManagementDialog,
  actionMenuAnchor,
  actionMenuTransaction,
  onCloseActionMenu,
  onOpenGraphModal,
  onConfigureApdex,
  onShowDetails,
  samplerActionMenuAnchor,
  samplerActionMenuData,
  onCloseSamplerActionMenu,
  onSetRequestGraphModalData,
  onSetRequestGraphModalOpen,
  onShowSamplerDetails,
  onOpenSamplerErrors,
}: PerformanceAnalysisMenusProps) {
  return (
    <>
      {/* Apdex actions menu */}
      <Menu
        anchorEl={apdexMenuAnchor}
        open={Boolean(apdexMenuAnchor)}
        onClose={onCloseApdexMenu}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
      >
        <MenuItem onClick={onOpenThresholdDialog}>
          <ListItemIcon>
            <SettingsIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Set Apdex Threshold</ListItemText>
        </MenuItem>
        <MenuItem onClick={onOpenSloDialog}>
          <ListItemIcon>
            <AssessmentIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Set Apdex SLO</ListItemText>
        </MenuItem>
        <MenuItem onClick={hasExplicitThreshold ? onOpenThresholdsManagementDialog : onOpenBaselineDialog}>
          <ListItemIcon>
            <InsightsIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{hasExplicitThreshold ? 'Modify Thresholds' : 'Set Baseline Apdex'}</ListItemText>
        </MenuItem>
      </Menu>

      {/* Transaction Action Menu */}
      <Menu
        anchorEl={actionMenuAnchor}
        open={Boolean(actionMenuAnchor)}
        onClose={onCloseActionMenu}
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
          onOpenGraphModal(actionMenuTransaction);
          onCloseActionMenu();
        }}>
          <ListItemIcon>
            <ShowChartIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>View Time-Series Graph</ListItemText>
        </MenuItem>
        <MenuItem onClick={onConfigureApdex}>
          <ListItemIcon>
            <SettingsIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Configure Apdex</ListItemText>
        </MenuItem>
        <MenuItem onClick={onShowDetails}>
          <ListItemIcon>
            <InfoIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Show More Details</ListItemText>
        </MenuItem>
        {hasDistributedTracing && onDrillDownToDistributedTracing && (
          <MenuItem onClick={() => {
            const transaction = transactions.find(t => t.transaction_name === actionMenuTransaction);
            if (transaction) {
              onDrillDownToDistributedTracing({
                scenario: transaction.scenario_name,
                transaction: transaction.transaction_name,
              });
            }
            onCloseActionMenu();
          }}>
            <ListItemIcon>
              <AccountTreeIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>View in Distributed Traces</ListItemText>
          </MenuItem>
        )}
        {hasDynatrace && onDrillDownToDynatrace && (
          <MenuItem onClick={() => {
            const transaction = transactions.find(t => t.transaction_name === actionMenuTransaction);
            if (transaction) {
              onDrillDownToDynatrace({
                scenario: transaction.scenario_name,
                transaction: transaction.transaction_name,
              });
            }
            onCloseActionMenu();
          }}>
            <ListItemIcon>
              <InsightsIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>View in Dynatrace</ListItemText>
          </MenuItem>
        )}
      </Menu>

      {/* Sampler Action Menu */}
      <Menu
        anchorEl={samplerActionMenuAnchor}
        open={Boolean(samplerActionMenuAnchor)}
        onClose={onCloseSamplerActionMenu}
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
          if (samplerActionMenuData) {
            onSetRequestGraphModalData({
              transactionName: samplerActionMenuData.transaction,
              samplerName: samplerActionMenuData.sampler.sampler_name,
            });
            onSetRequestGraphModalOpen(true);
            onCloseSamplerActionMenu();
          }
        }}>
          <ListItemIcon>
            <ShowChartIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>View Time-Series Graph</ListItemText>
        </MenuItem>
        <MenuItem onClick={onShowSamplerDetails}>
          <ListItemIcon>
            <InfoIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Show More Details</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => {
          if (samplerActionMenuData) {
            onOpenSamplerErrors(samplerActionMenuData.transaction, samplerActionMenuData.sampler.sampler_name);
            onCloseSamplerActionMenu();
          }
        }}>
          <ListItemIcon>
            <ErrorIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>View Errors</ListItemText>
        </MenuItem>
        {hasDistributedTracing && onDrillDownToDistributedTracing && (
          <MenuItem onClick={() => {
            if (samplerActionMenuData) {
              const transaction = transactions.find(t => t.transaction_name === samplerActionMenuData.transaction);
              onDrillDownToDistributedTracing({
                scenario: transaction?.scenario_name || samplerActionMenuData.sampler.scenario_name,
                transaction: samplerActionMenuData.transaction,
                sampler: samplerActionMenuData.sampler.sampler_name,
              });
            }
            onCloseSamplerActionMenu();
          }}>
            <ListItemIcon>
              <AccountTreeIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>View in Distributed Traces</ListItemText>
          </MenuItem>
        )}
        {hasDynatrace && onDrillDownToDynatrace && (
          <MenuItem onClick={() => {
            if (samplerActionMenuData) {
              const transaction = transactions.find(t => t.transaction_name === samplerActionMenuData.transaction);
              onDrillDownToDynatrace({
                scenario: transaction?.scenario_name || samplerActionMenuData.sampler.scenario_name,
                transaction: samplerActionMenuData.transaction,
                sampler: samplerActionMenuData.sampler.sampler_name,
              });
            }
            onCloseSamplerActionMenu();
          }}>
            <ListItemIcon>
              <InsightsIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>View in Dynatrace</ListItemText>
          </MenuItem>
        )}
      </Menu>
    </>
  );
}
