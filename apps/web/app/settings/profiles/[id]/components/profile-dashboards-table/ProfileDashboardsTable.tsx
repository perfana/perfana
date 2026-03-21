'use client';

import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  CircularProgress,
  Alert,
  Checkbox,
} from '@mui/material';
import { ProfileDashboard } from '@/lib/profiles';
import { useDeleteDialog } from './hooks';
import {
  DeleteDashboardDialog,
  BatchActionsToolbar,
  DashboardTableRow,
  EmptyState,
} from './components';

interface ProfileDashboardsTableProps {
  dashboards: ProfileDashboard[];
  loading: boolean;
  error: string;
  selectedDashboardIds: Set<string>;
  onEdit: (dashboard: ProfileDashboard) => void;
  onDelete: (dashboardId: string) => void;
  onSelectAll: () => void;
  onSelectOne: (id: string) => void;
  onBatchDelete: () => void;
}

/**
 * Table component displaying auto-configuration dashboards for a profile
 * Follows the design patterns from DashboardTable.tsx with fancy chips and proper styling
 */
export default function ProfileDashboardsTable({
  dashboards,
  loading,
  error,
  selectedDashboardIds,
  onEdit,
  onDelete,
  onSelectAll,
  onSelectOne,
  onBatchDelete,
}: ProfileDashboardsTableProps) {
  const {
    deleteDialogOpen,
    dashboardToDelete,
    handleDeleteClick,
    handleDeleteConfirm,
    handleDeleteCancel,
  } = useDeleteDialog({ onDelete });

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
        <CircularProgress size={40} />
      </Box>
    );
  }

  if (error) {
    return <Alert severity="error">{error}</Alert>;
  }

  if (dashboards.length === 0) {
    return <EmptyState />;
  }

  const isAllSelected = selectedDashboardIds.size === dashboards.length;
  const isIndeterminate = selectedDashboardIds.size > 0 && selectedDashboardIds.size < dashboards.length;

  return (
    <>
      <BatchActionsToolbar
        selectedCount={selectedDashboardIds.size}
        onBatchDelete={onBatchDelete}
        onClearSelection={onSelectAll}
      />

      <TableContainer>
        <Table sx={{ minWidth: 900 }} aria-label="profile dashboards table">
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox
                  checked={selectedDashboardIds.size > 0 && isAllSelected}
                  indeterminate={isIndeterminate}
                  onChange={onSelectAll}
                  inputProps={{ 'aria-label': 'Select all dashboards' }}
                />
              </TableCell>
              <TableCell><strong>Dashboard Name</strong></TableCell>
              <TableCell><strong>Grafana Instance</strong></TableCell>
              <TableCell><strong>Tags</strong></TableCell>
              <TableCell><strong>Separate Dashboard For</strong></TableCell>
              <TableCell><strong>Hardcoded Variables</strong></TableCell>
              <TableCell><strong>Regex Rules</strong></TableCell>
              <TableCell align="center"><strong>Actions</strong></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {dashboards.map((dashboard) => (
              <DashboardTableRow
                key={dashboard.id}
                dashboard={dashboard}
                isSelected={selectedDashboardIds.has(dashboard.id)}
                onSelect={onSelectOne}
                onEdit={onEdit}
                onDelete={handleDeleteClick}
              />
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <DeleteDashboardDialog
        open={deleteDialogOpen}
        dashboardName={dashboardToDelete?.dashboardName ?? null}
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
      />
    </>
  );
}
