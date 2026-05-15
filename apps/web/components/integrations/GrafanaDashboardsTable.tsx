'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  Paper,
  Chip,
  IconButton,
  TextField,
  InputAdornment,
  Tabs,
  Tab,
  Tooltip,
  CircularProgress,
  Alert,
  Link,
  Checkbox,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material'
import {
  OpenInNew,
  Delete,
  Search,
  Refresh,
} from '@mui/icons-material'
import { useThemeMode } from '@/contexts/theme-context'
import { fetchGrafanaDashboards, deleteGrafanaDashboard, GrafanaDashboard } from '@/lib/grafana-dashboards'
import { GrafanaInstance } from '@/lib/grafana-instances'

// Artificial dashboards created by performance-metrics pipeline don't exist in Grafana
const ARTIFICIAL_DASHBOARD_UID_PREFIX = 'performance-test-metrics-'

/**
 * Check if a dashboard is "artificial" (created by performance-metrics pipeline)
 * These dashboards don't actually exist in Grafana - they're synthetic entries for metrics
 */
function isArtificialDashboard(dashboard: { uid?: string }): boolean {
  return dashboard.uid?.startsWith(ARTIFICIAL_DASHBOARD_UID_PREFIX) ?? false
}

interface GrafanaDashboardsTableProps {
  grafanaInstance: GrafanaInstance
  onError?: (message: string) => void
  onSuccess?: (message: string) => void
}

type DashboardTab = 'templates' | 'usedBySut' | 'other'

export default function GrafanaDashboardsTable({
  grafanaInstance,
  onError,
  onSuccess
}: GrafanaDashboardsTableProps) {
  const { mode } = useThemeMode()
  const [dashboards, setDashboards] = useState<GrafanaDashboard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<DashboardTab>('templates')
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(10)
  const [selectedDashboards, setSelectedDashboards] = useState<Set<string>>(new Set())
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [dashboardToDelete, setDashboardToDelete] = useState<GrafanaDashboard | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [selectedSutFilter, setSelectedSutFilter] = useState<string>('')

  const loadDashboards = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await fetchGrafanaDashboards({ grafanaInstanceId: grafanaInstance.id })
      setDashboards(data)
    } catch (err) {
      const message = err && typeof err === 'object' && 'message' in err
        ? (err as Error).message
        : 'Failed to load dashboards'
      setError(message)
      onError?.(message)
    } finally {
      setLoading(false)
    }
  }, [grafanaInstance.id, onError])

  useEffect(() => {
    loadDashboards()
  }, [loadDashboards])

  // Get all unique SUTs from dashboards for the filter dropdown
  const allSuts = useMemo(() => {
    const sutSet = new Set<string>()
    dashboards.forEach(d => {
      d.usedBySut?.forEach(sut => sutSet.add(sut))
    })
    return Array.from(sutSet).sort()
  }, [dashboards])

  // Filter dashboards by tab
  const filteredDashboards = useMemo(() => {
    let filtered = dashboards

    // Filter by tab
    switch (activeTab) {
      case 'templates':
        filtered = dashboards.filter(d =>
          d.tags?.some(tag => tag.toLowerCase().includes('perfana-template'))
        )
        break
      case 'usedBySut':
        filtered = dashboards.filter(d =>
          d.usedBySut && d.usedBySut.length > 0
        )
        // Apply SUT filter if selected
        if (selectedSutFilter) {
          filtered = filtered.filter(d =>
            d.usedBySut?.includes(selectedSutFilter)
          )
        }
        break
      case 'other':
        filtered = dashboards.filter(d =>
          !d.tags?.some(tag => tag.toLowerCase().includes('perfana-template')) &&
          (!d.usedBySut || d.usedBySut.length === 0) &&
          !isArtificialDashboard(d)
        )
        break
    }

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(d =>
        d.name.toLowerCase().includes(query) ||
        d.uid.toLowerCase().includes(query) ||
        d.usedBySut?.some(sut => sut.toLowerCase().includes(query))
      )
    }

    return filtered
  }, [dashboards, activeTab, searchQuery, selectedSutFilter])

  // Reset page when filter changes
  useEffect(() => {
    setPage(0)
  }, [activeTab, searchQuery, selectedSutFilter])

  const handleTabChange = (_: React.SyntheticEvent, newValue: DashboardTab) => {
    setActiveTab(newValue)
    setSelectedDashboards(new Set())
    setSelectedSutFilter('')
  }

  const handleChangePage = (_: unknown, newPage: number) => {
    setPage(newPage)
  }

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10))
    setPage(0)
  }

  const handleSelectAll = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.checked) {
      const paginatedIds = paginatedDashboards.map(d => d.id)
      setSelectedDashboards(new Set(paginatedIds))
    } else {
      setSelectedDashboards(new Set())
    }
  }

  const handleSelectOne = (dashboardId: string) => {
    const newSelected = new Set(selectedDashboards)
    if (newSelected.has(dashboardId)) {
      newSelected.delete(dashboardId)
    } else {
      newSelected.add(dashboardId)
    }
    setSelectedDashboards(newSelected)
  }

  const handleDeleteClick = (dashboard: GrafanaDashboard) => {
    setDashboardToDelete(dashboard)
    setDeleteDialogOpen(true)
  }

  const handleDeleteConfirm = async () => {
    if (!dashboardToDelete) return

    try {
      setDeleting(true)
      await deleteGrafanaDashboard(dashboardToDelete.id)
      setDashboards(dashboards.filter(d => d.id !== dashboardToDelete.id))
      onSuccess?.(`Dashboard "${dashboardToDelete.name}" deleted successfully`)
    } catch (err) {
      const message = err && typeof err === 'object' && 'message' in err
        ? (err as Error).message
        : 'Failed to delete dashboard'
      onError?.(message)
    } finally {
      setDeleting(false)
      setDeleteDialogOpen(false)
      setDashboardToDelete(null)
    }
  }

  const handleBulkDelete = async () => {
    if (selectedDashboards.size === 0) return

    try {
      setDeleting(true)
      const deletePromises = Array.from(selectedDashboards).map(id =>
        deleteGrafanaDashboard(id)
      )
      await Promise.all(deletePromises)
      setDashboards(dashboards.filter(d => !selectedDashboards.has(d.id)))
      onSuccess?.(`${selectedDashboards.size} dashboard(s) deleted successfully`)
      setSelectedDashboards(new Set())
    } catch (err) {
      const message = err && typeof err === 'object' && 'message' in err
        ? (err as Error).message
        : 'Failed to delete dashboards'
      onError?.(message)
    } finally {
      setDeleting(false)
    }
  }

  const openDashboardInGrafana = (dashboard: GrafanaDashboard) => {
    const baseUrl = grafanaInstance.clientUrl.replace(/\/$/, '')
    const url = `${baseUrl}/d/${dashboard.uid}?orgId=${grafanaInstance.orgId}&from=now-15m&to=now&theme=${mode}`
    window.open(url, '_blank')
  }

  const formatDate = (dateString?: string) => {
    if (!dateString) return '-'
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return dateString
    }
  }

  const paginatedDashboards = filteredDashboards.slice(
    page * rowsPerPage,
    page * rowsPerPage + rowsPerPage
  )

  const isAllSelected = paginatedDashboards.length > 0 &&
    paginatedDashboards.every(d => selectedDashboards.has(d.id))

  const tabCounts = useMemo(() => ({
    templates: dashboards.filter(d =>
      d.tags?.some(tag => tag.toLowerCase().includes('perfana-template'))
    ).length,
    usedBySut: dashboards.filter(d =>
      d.usedBySut && d.usedBySut.length > 0
    ).length,
    other: dashboards.filter(d =>
      !d.tags?.some(tag => tag.toLowerCase().includes('perfana-template')) &&
      (!d.usedBySut || d.usedBySut.length === 0) &&
      !isArtificialDashboard(d)
    ).length,
  }), [dashboards])

  // Stop propagation to prevent card collapse when clicking inside the table
  const stopPropagation = (e: React.MouseEvent) => {
    e.stopPropagation()
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 4 }} onClick={stopPropagation}>
        <CircularProgress size={24} sx={{ mr: 1 }} />
        <Typography variant="body2" color="text.secondary">Loading dashboards...</Typography>
      </Box>
    )
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ mt: 2 }} onClick={stopPropagation}>
        {error}
        <Button size="small" onClick={(e) => { e.stopPropagation(); loadDashboards(); }} sx={{ ml: 2 }}>
          Retry
        </Button>
      </Alert>
    )
  }

  return (
    <Box sx={{ mt: 2 }} onClick={stopPropagation}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          Dashboards ({dashboards.length})
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {selectedDashboards.size > 0 && (
            <Button
              size="small"
              color="error"
              variant="outlined"
              startIcon={<Delete />}
              onClick={handleBulkDelete}
              disabled={deleting}
            >
              Delete Selected ({selectedDashboards.size})
            </Button>
          )}
          <Tooltip title="Refresh dashboards">
            <IconButton size="small" onClick={loadDashboards} disabled={loading}>
              <Refresh fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Tabs
          value={activeTab}
          onChange={handleTabChange}
          variant="scrollable"
          scrollButtons="auto"
        >
          <Tab
            label={`Template Dashboards (${tabCounts.templates})`}
            value="templates"
          />
          <Tab
            label={`Used by SUT (${tabCounts.usedBySut})`}
            value="usedBySut"
          />
          <Tab
            label={`Other Dashboards (${tabCounts.other})`}
            value="other"
          />
        </Tabs>
      </Box>

      <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <TextField
          size="small"
          placeholder="Search dashboards..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          sx={{ width: '100%', maxWidth: 300 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search fontSize="small" />
              </InputAdornment>
            ),
          }}
        />
        {activeTab === 'usedBySut' && allSuts.length > 0 && (
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel id="sut-filter-label">Filter by SUT</InputLabel>
            <Select
              labelId="sut-filter-label"
              value={selectedSutFilter}
              label="Filter by SUT"
              onChange={(e) => setSelectedSutFilter(e.target.value)}
            >
              <MenuItem value="">
                <em>All SUTs</em>
              </MenuItem>
              {allSuts.map((sut) => (
                <MenuItem key={sut} value={sut}>
                  {sut}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
      </Box>

      {filteredDashboards.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
          No dashboards found{searchQuery || selectedSutFilter ? ' matching your filters' : ' in this category'}
        </Typography>
      ) : (
        <>
          <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 400 }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox">
                    <Checkbox
                      size="small"
                      checked={isAllSelected}
                      indeterminate={selectedDashboards.size > 0 && !isAllSelected}
                      onChange={handleSelectAll}
                    />
                  </TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Dashboard Name</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Last Synced</TableCell>
                  {activeTab !== 'templates' && (
                    <TableCell sx={{ fontWeight: 600 }}>Used by SUT</TableCell>
                  )}
                  <TableCell sx={{ fontWeight: 600 }}>Tags</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 600, width: 100 }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {paginatedDashboards.map((dashboard) => (
                  <TableRow
                    key={dashboard.id}
                    hover
                    selected={selectedDashboards.has(dashboard.id)}
                  >
                    <TableCell padding="checkbox">
                      <Checkbox
                        size="small"
                        checked={selectedDashboards.has(dashboard.id)}
                        onChange={() => handleSelectOne(dashboard.id)}
                      />
                    </TableCell>
                    <TableCell>
                      <Link
                        component="button"
                        variant="body2"
                        onClick={() => openDashboardInGrafana(dashboard)}
                        sx={{
                          textAlign: 'left',
                          textDecoration: 'none',
                          '&:hover': { textDecoration: 'underline' }
                        }}
                      >
                        {dashboard.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {formatDate(dashboard.updated || dashboard.updatedAt)}
                      </Typography>
                    </TableCell>
                    {activeTab !== 'templates' && (
                      <TableCell>
                        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                          {dashboard.usedBySut?.slice(0, 3).map((sut, index) => (
                            <Chip
                              key={index}
                              label={sut}
                              size="small"
                              variant="outlined"
                              sx={{ fontSize: '0.7rem', height: 20 }}
                            />
                          ))}
                          {(dashboard.usedBySut?.length || 0) > 3 && (
                            <Chip
                              label={`+${(dashboard.usedBySut?.length || 0) - 3} more`}
                              size="small"
                              sx={{ fontSize: '0.7rem', height: 20 }}
                            />
                          )}
                        </Box>
                      </TableCell>
                    )}
                    <TableCell>
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {dashboard.tags?.filter(tag =>
                          tag.toLowerCase().includes('perfana-template')
                        ).map((tag, index) => (
                          <Chip
                            key={index}
                            label={tag}
                            size="small"
                            color="primary"
                            variant="outlined"
                            sx={{ fontSize: '0.7rem', height: 20 }}
                          />
                        ))}
                      </Box>
                    </TableCell>
                    <TableCell align="center">
                      <Tooltip title="Open in Grafana">
                        <IconButton
                          size="small"
                          onClick={() => openDashboardInGrafana(dashboard)}
                        >
                          <OpenInNew fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete dashboard">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => handleDeleteClick(dashboard)}
                        >
                          <Delete fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          <TablePagination
            component="div"
            count={filteredDashboards.length}
            page={page}
            onPageChange={handleChangePage}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={handleChangeRowsPerPage}
            rowsPerPageOptions={[5, 10, 20, 50]}
          />
        </>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>Delete Dashboard</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete the dashboard &quot;{dashboardToDelete?.name}&quot;?
            This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button
            onClick={handleDeleteConfirm}
            color="error"
            variant="contained"
            disabled={deleting}
          >
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
