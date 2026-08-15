'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { getSystemName } from '../utils/test-runs-filters';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Tooltip,
  Checkbox,
} from '@mui/material';
import { DataGrid, GridColDef, GridPaginationModel } from '@mui/x-data-grid';
import {
  PlayArrow,
  Flag,
  AutoAwesomeMotionTwoTone,
} from '@mui/icons-material';
import { TestRun } from '@/types/test-runs';
import {
  TestRunStatusChip,
  ProgressBar,
  ResultStatusIcon,
  AbortTestRunButton,
} from './index';
import {
  formatDuration,
  calculateElapsedDuration,
} from '../utils';
import { useOrganizationContext } from '@/lib/contexts/organization-context';
import { PaginationState } from '../hooks/useTestRunsData';

interface TestRunsTableProps {
  testRuns: TestRun[];
  selectedTestRunIds: Set<string>;
  currentTime: number;
  systemFilter: string;
  environmentFilter: string;
  workloadFilter: string;
  variant: 'running' | 'completed';
  onSelectAll: () => void;
  onSelectOne: (id: string) => void;
  pagination?: PaginationState;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageLoading?: boolean;
  showToast?: (message: string) => void;
  onRefresh?: () => void;
}

export function TestRunsTable({
  testRuns,
  selectedTestRunIds,
  currentTime,
  systemFilter,
  environmentFilter,
  workloadFilter,
  variant,
  onSelectAll,
  onSelectOne,
  pagination,
  onPageChange,
  onPageSizeChange,
  pageLoading,
  showToast,
  onRefresh,
}: TestRunsTableProps) {
  const router = useRouter();
  const { currentOrganizationId } = useOrganizationContext();

  const handleRowClick = (testRun: TestRun, event: React.MouseEvent) => {
    // Don't navigate if clicking on the select column
    const target = event.target as HTMLElement;
    if (target.closest('[data-field="select"]')) {
      return;
    }

    const params: Record<string, string> = {
      system: testRun.systems_under_test?.name || getSystemName(testRun) || '',
      environment: testRun.test_environment || '',
      workload: testRun.workload || '',
    };
    if (currentOrganizationId) {
      params.organizationId = currentOrganizationId;
    }
    const searchParams = new URLSearchParams(params);
    router.push(`/test-runs/${testRun.test_run_id}?${searchParams.toString()}`);
  };

  // Version tooltip renderer
  const renderVersionTooltip = (version: string, annotations?: string[]) => (
    <Box sx={{ p: 1 }}>
      <Typography variant="body2" sx={{ color: 'white', fontSize: '0.75rem', mb: annotations && annotations.length > 0 ? 1 : 0 }}>
        {version}
      </Typography>
      {annotations && annotations.length > 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          {annotations.map((annotation: string, index: number) => (
            <Typography key={index} variant="body2" sx={{ color: 'white', fontSize: '0.75rem' }}>
              {annotations.length > 1 ? `${index + 1}. ${annotation}` : annotation}
            </Typography>
          ))}
        </Box>
      )}
    </Box>
  );

  const tooltipStyles = {
    '& .MuiTooltip-tooltip': {
      backgroundColor: 'rgba(33, 33, 33, 0.95)',
      backdropFilter: 'blur(10px)',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderRadius: '8px',
      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
      maxWidth: 280,
    },
    '& .MuiTooltip-arrow': {
      color: 'rgba(33, 33, 33, 0.95)',
    }
  };

  // Running tests columns
  const runningColumns: GridColDef[] = useMemo(() => {
    const allColumns: GridColDef[] = [
      {
        field: 'system_name',
        headerName: 'System',
        minWidth: 100,
        flex: 1.2,
        valueGetter: (_value, row) => row?.systems_under_test?.name || 'Unknown System',
      },
      {
        field: 'test_run_id',
        headerName: 'Test Run ID',
        minWidth: 180,
        flex: 2.6,
        maxWidth: 400,
      },
      {
        field: 'test_environment',
        headerName: 'Environment',
        minWidth: 100,
        flex: 1,
        maxWidth: 150,
      },
      {
        field: 'workload',
        headerName: 'Workload',
        minWidth: 100,
        flex: 1,
        maxWidth: 150,
      },
      {
        field: 'status',
        headerName: 'Status',
        minWidth: 90,
        flex: 0.8,
        maxWidth: 120,
        renderCell: (params) => (
          <TestRunStatusChip testRun={params.row} currentTime={currentTime} />
        ),
        sortable: false,
      },
      {
        field: 'application_release',
        headerName: 'Version',
        minWidth: 80,
        flex: 1,
        maxWidth: 120,
        renderCell: (params) => {
          const version = params.row?.application_release || 'N/A';
          return (
            <Tooltip title={renderVersionTooltip(version, params.row?.annotations)} arrow placement="top" sx={tooltipStyles}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'help' }}>
                {version}
              </span>
            </Tooltip>
          );
        },
      },
      {
        field: 'start_time',
        headerName: 'Start',
        minWidth: 140,
        flex: 1.5,
        maxWidth: 180,
        valueGetter: (_value, row) => row?.start_time ? new Date(row.start_time).toLocaleString() : 'N/A',
      },
      {
        field: 'elapsed',
        headerName: 'Elapsed',
        minWidth: 90,
        flex: 0.8,
        maxWidth: 120,
        renderCell: (params) => {
          const elapsed = calculateElapsedDuration(params.row, currentTime);
          return <span>{formatDuration(elapsed)}</span>;
        },
      },
      {
        field: 'progress',
        headerName: 'Progress',
        minWidth: 130,
        flex: 1.2,
        maxWidth: 160,
        renderCell: (params) => <ProgressBar testRun={params.row} currentTime={currentTime} />,
        sortable: false,
      },
      {
        field: 'actions',
        headerName: '',
        width: 60,
        sortable: false,
        disableColumnMenu: true,
        renderCell: (params) => (
          <AbortTestRunButton
            testRun={params.row}
            onAborted={onRefresh}
            showToast={showToast}
            variant="icon"
          />
        ),
      },
    ];

    return allColumns.filter(column => {
      if (column.field === 'system_name' && systemFilter) return false;
      if (column.field === 'test_environment' && environmentFilter) return false;
      if (column.field === 'workload' && workloadFilter) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemFilter, environmentFilter, workloadFilter, currentTime, showToast, onRefresh]);

  // Completed tests columns
  const completedColumns: GridColDef[] = useMemo(() => {
    const allColumns: GridColDef[] = [
      {
        field: 'system_name',
        headerName: 'System',
        minWidth: 100,
        flex: 1.2,
        valueGetter: (_value, row) => row?.systems_under_test?.name || 'Unknown System',
      },
      {
        field: 'test_run_id',
        headerName: 'Test Run ID',
        minWidth: 180,
        flex: 2.6,
        maxWidth: 400,
      },
      {
        field: 'test_environment',
        headerName: 'Environment',
        minWidth: 100,
        flex: 1,
        maxWidth: 150,
      },
      {
        field: 'workload',
        headerName: 'Workload',
        minWidth: 100,
        flex: 1,
        maxWidth: 150,
      },
      {
        field: 'application_release',
        headerName: 'Version',
        minWidth: 80,
        flex: 1.5,
        maxWidth: 120,
        renderCell: (params) => {
          const version = params.row?.application_release || 'N/A';
          return (
            <Tooltip title={renderVersionTooltip(version, params.row?.annotations)} arrow placement="top" sx={tooltipStyles}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'help' }}>
                {version}
              </span>
            </Tooltip>
          );
        },
      },
      {
        field: 'start_time',
        headerName: 'Start',
        minWidth: 140,
        flex: 1.5,
        maxWidth: 180,
        valueGetter: (_value, row) => row?.start_time ? new Date(row.start_time).toLocaleString() : 'N/A',
      },
      {
        field: 'duration',
        headerName: 'Duration',
        minWidth: 90,
        flex: 0.8,
        maxWidth: 120,
        renderCell: (params) => {
          const row = params.row;
          let displayDuration = 0;

          if (row?.end_time && row?.start_time) {
            const startTime = new Date(row.start_time).getTime();
            const endTime = new Date(row.end_time).getTime();
            displayDuration = Math.floor((endTime - startTime) / 1000);
          }

          return <span>{formatDuration(displayDuration)}</span>;
        },
      },
      {
        field: 'result',
        headerName: 'Result',
        minWidth: 70,
        flex: 0.6,
        maxWidth: 80,
        renderCell: (params) => (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
            <ResultStatusIcon testRun={params.row} />
          </Box>
        ),
        sortable: false,
        align: 'center',
        headerAlign: 'center',
      },
      {
        field: 'changepoint',
        headerName: 'ADAPT',
        minWidth: 80,
        flex: 0.6,
        maxWidth: 100,
        renderCell: (params) => (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', gap: 0.5 }}>
            {params.row.adapt_config?.mode === 'BASELINE' && (
              <Tooltip title="Baseline mode — always accepted into control group">
                <Box sx={{
                  px: 0.75,
                  py: 0.25,
                  borderRadius: 1,
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  letterSpacing: '0.03em',
                  textTransform: 'uppercase',
                  bgcolor: 'info.main',
                  color: 'info.contrastText',
                  lineHeight: 1.4,
                }}>
                  BL
                </Box>
              </Tooltip>
            )}
            {params.row.is_changepoint ? (
              <Tooltip title="Marked as changepoint">
                <Flag sx={{ color: '#1976d2', fontSize: '20px' }} />
              </Tooltip>
            ) : params.row.is_control_group && params.row.adapt_config?.mode !== 'BASELINE' ? (
              <Tooltip title="In control group for most recent test run">
                <AutoAwesomeMotionTwoTone sx={{ color: '#9c27b0', fontSize: '20px' }} />
              </Tooltip>
            ) : null}
          </Box>
        ),
        sortable: false,
        align: 'center',
        headerAlign: 'center',
      },
      {
        field: 'select',
        headerName: '',
        width: 50,
        minWidth: 50,
        maxWidth: 50,
        sortable: false,
        filterable: false,
        disableColumnMenu: true,
        renderHeader: () => (
          <Checkbox
            checked={selectedTestRunIds.size > 0 && selectedTestRunIds.size === testRuns.length}
            indeterminate={selectedTestRunIds.size > 0 && selectedTestRunIds.size < testRuns.length}
            onChange={onSelectAll}
            inputProps={{ 'aria-label': 'Select all test runs' }}
          />
        ),
        renderCell: (params) => (
          <Checkbox
            checked={selectedTestRunIds.has(params.row.id)}
            onChange={(e) => {
              e.stopPropagation();
              onSelectOne(params.row.id);
            }}
            onClick={(e) => e.stopPropagation()}
            inputProps={{ 'aria-label': `Select test run ${params.row.test_run_id}` }}
          />
        ),
      },
    ];

    // Filter out columns based on active filters
    const visibleColumns = allColumns.filter(column => {
      if (column.field === 'select') return true;
      if (column.field === 'system_name' && systemFilter) return false;
      if (column.field === 'test_environment' && environmentFilter) return false;
      if (column.field === 'workload' && workloadFilter) return false;
      return true;
    });

    // Redistribute flex space when columns are hidden
    const hiddenFlexSpace =
      (systemFilter ? 1.2 : 0) +
      (environmentFilter ? 1 : 0) +
      (workloadFilter ? 1 : 0);

    if (hiddenFlexSpace > 0) {
      return visibleColumns.map(column => {
        if (column.field === 'select' || column.field === 'result' || column.field === 'changepoint') {
          return column;
        }

        const originalFlex = column.flex || 1;
        const flexIncrease = hiddenFlexSpace * (originalFlex / 8.3);

        const updatedColumn = {
          ...column,
          flex: originalFlex + flexIncrease
        };

        if (updatedColumn.maxWidth) {
          delete updatedColumn.maxWidth;
        }

        return updatedColumn;
      });
    }

    return visibleColumns;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemFilter, environmentFilter, workloadFilter, selectedTestRunIds, testRuns.length, onSelectAll, onSelectOne]);

  const columns = variant === 'running' ? runningColumns : completedColumns;
  const isRunning = variant === 'running';

  const isServerPaginated = !isRunning && pagination && onPageChange && onPageSizeChange;

  const handlePaginationModelChange = (model: GridPaginationModel) => {
    if (!isServerPaginated) return;
    // DataGrid uses 0-indexed pages, API uses 1-indexed
    const newPage = model.page + 1;
    const newPageSize = model.pageSize;

    if (newPageSize !== pagination.pageSize) {
      // Page size change resets to page 1 in the hook
      onPageSizeChange(newPageSize);
    }
    if (newPage !== pagination.page && newPageSize === pagination.pageSize) {
      onPageChange(newPage);
    }
  };

  const dataGridSx = {
    border: 0,
    '& .MuiDataGrid-columnHeader': {
      '& .MuiDataGrid-columnHeaderTitle': {
        fontSize: '0.75rem',
        fontWeight: 500,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: '#6b7280',
      },
    },
    '& .MuiDataGrid-columnHeaders': {
      backgroundColor: isRunning ? 'rgba(25, 118, 210, 0.04)' : '#f9fafb',
    },
    '& .MuiDataGrid-cell:focus': {
      outline: 'none',
    },
    '& .MuiDataGrid-row:hover': {
      backgroundColor: isRunning ? 'rgba(25, 118, 210, 0.08)' : 'action.hover',
      cursor: 'pointer',
    },
  };

  if (isRunning) {
    return (
      <Card sx={{ mb: 3, flexShrink: 0 }}>
        <CardContent sx={{ pb: 0 }}>
          <Box display="flex" alignItems="center" gap={1} mb={2}>
            <PlayArrow sx={{ color: '#1976d2' }} />
            <Typography variant="h6" component="h2">
              Running Tests ({testRuns.length})
            </Typography>
          </Box>
        </CardContent>
        <Box sx={{
          height: Math.min(300, 52 + testRuns.length * 52),
          width: '100%',
          minHeight: '104px'
        }}>
          <DataGrid
            rows={testRuns}
            columns={columns}
            getRowId={(row) => row.id}
            pageSizeOptions={[5, 10]}
            initialState={{
              pagination: { paginationModel: { page: 0, pageSize: 5 } },
            }}
            disableRowSelectionOnClick
            autoPageSize={false}
            disableColumnResize={false}
            hideFooterSelectedRowCount
            hideFooter={testRuns.length <= 5}
            disableVirtualization={false}
            onRowClick={(params, event) => handleRowClick(params.row, event)}
            sx={dataGridSx}
          />
        </Box>
      </Card>
    );
  }

  return (
    <Card sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <CardContent sx={{ pb: 0, flexShrink: 0 }}>
        <Typography variant="h6" component="h2" mb={2}>
          Completed Tests {pagination ? `(${pagination.total})` : `(${testRuns.length})`}
        </Typography>
      </CardContent>
      <Box sx={{ flex: 1, width: '100%', minHeight: 0 }}>
        <DataGrid
          rows={testRuns}
          columns={columns}
          getRowId={(row) => row.id}
          loading={pageLoading}
          {...(isServerPaginated
            ? {
                paginationMode: 'server' as const,
                rowCount: pagination.total,
                paginationModel: {
                  page: pagination.page - 1, // DataGrid is 0-indexed
                  pageSize: pagination.pageSize,
                },
                onPaginationModelChange: handlePaginationModelChange,
                pageSizeOptions: [10, 25, 50, 100],
              }
            : {
                pageSizeOptions: [10, 25, 50],
                initialState: {
                  pagination: { paginationModel: { page: 0, pageSize: 25 } },
                },
              }
          )}
          disableRowSelectionOnClick
          autoPageSize={false}
          disableColumnResize={false}
          hideFooterSelectedRowCount
          disableVirtualization={false}
          onRowClick={(params, event) => handleRowClick(params.row, event)}
          sx={dataGridSx}
        />
      </Box>
    </Card>
  );
}
