'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Box,
  Typography,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  DialogContentText,
  TextField,
  MenuItem,
  Snackbar,
  CircularProgress,
  Tabs,
  Tab,
  Paper,
  Breadcrumbs,
} from '@mui/material';
import {
  Add,
  Delete as DeleteIcon,
  ArrowBack,
  FilterAlt,
  Block,
} from '@mui/icons-material';
import Link from 'next/link';
import {
  AlertTagFilter,
  fetchAlertTagFilters,
  createAlertTagFilter,
  deleteAlertTagFilter,
  CreateAlertTagFilterInput,
} from '@/lib/alert-tag-filters';
import {
  fetchAllSystemsUnderTest,
  fetchSystemSummary,
  SystemSummary,
} from '@/lib/systems';
import { SystemUnderTest } from '@/types/test-runs';

const ALERT_SOURCES = [
  { value: 'grafana', label: 'Grafana' },
  { value: 'alertmanager', label: 'Alertmanager' },
] as const;

function EmptyState({ type }: { type: 'omit' | 'abort' }) {
  return (
    <Box sx={{ textAlign: 'center', py: 6 }}>
      <Box sx={{
        width: 64, height: 64, borderRadius: '50%', mx: 'auto', mb: 2,
        background: type === 'omit'
          ? 'linear-gradient(135deg, rgba(255, 152, 0, 0.1), rgba(255, 152, 0, 0.05))'
          : 'linear-gradient(135deg, rgba(244, 67, 54, 0.1), rgba(244, 67, 54, 0.05))',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {type === 'omit'
          ? <FilterAlt sx={{ fontSize: 32, color: 'warning.main' }} />
          : <Block sx={{ fontSize: 32, color: 'error.main' }} />
        }
      </Box>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>
        No {type === 'omit' ? 'Omit Tag' : 'Abort'} Filters
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {type === 'omit'
          ? 'Add filters to strip specific tags from alerts before storing them as events.'
          : 'Add filters to automatically abort test runs when matching alerts fire.'}
      </Typography>
    </Box>
  );
}

export default function AlertFiltersPage() {
  const [filters, setFilters] = useState<AlertTagFilter[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [filterToDelete, setFilterToDelete] = useState<AlertTagFilter | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '' });

  // SUT data for dropdowns and name resolution
  const [systems, setSystems] = useState<SystemUnderTest[]>([]);
  const [selectedSummary, setSelectedSummary] = useState<SystemSummary | null>(null);

  // Form state
  const [formSource, setFormSource] = useState<'grafana' | 'alertmanager'>('grafana');
  const [formTagKey, setFormTagKey] = useState('');
  const [formTagValue, setFormTagValue] = useState('');
  const [formSutId, setFormSutId] = useState('');
  const [formEnv, setFormEnv] = useState('');
  const [formTestType, setFormTestType] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // SUT ID -> name lookup
  const sutNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of systems) {
      if (s.id) map.set(s.id, s.name);
    }
    return map;
  }, [systems]);

  // Cascading options from selected SUT summary
  const environmentOptions = useMemo(
    () => selectedSummary?.environments.map(e => e.environment).sort() ?? [],
    [selectedSummary],
  );

  const workloadOptions = useMemo(() => {
    if (!selectedSummary || !formEnv) return [];
    const env = selectedSummary.environments.find(e => e.environment === formEnv);
    return env?.workloads.sort() ?? [];
  }, [selectedSummary, formEnv]);

  const loadFilters = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAlertTagFilters();
      setFilters(data);
    } catch (err) {
      const msg = err && typeof err === 'object' && 'message' in err
        ? (err as Error).message : 'Failed to load filters';
      setSnackbar({ open: true, message: msg });
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSystems = useCallback(async () => {
    try {
      const data = await fetchAllSystemsUnderTest();
      setSystems(data);
    } catch {
      // Non-blocking — dropdowns just won't populate
    }
  }, []);

  useEffect(() => { loadFilters(); loadSystems(); }, [loadFilters, loadSystems]);

  // When SUT selection changes, fetch its summary for env/workload cascading
  useEffect(() => {
    if (!formSutId) {
      setSelectedSummary(null);
      return;
    }
    let cancelled = false;
    fetchSystemSummary(formSutId)
      .then(summary => { if (!cancelled) setSelectedSummary(summary); })
      .catch(() => { if (!cancelled) setSelectedSummary(null); });
    return () => { cancelled = true; };
  }, [formSutId]);

  const filterType = tab === 0 ? 'omit' : 'abort';
  const filteredList = filters.filter(f => f.filterType === filterType);

  const resetForm = () => {
    setFormSource('grafana');
    setFormTagKey('');
    setFormTagValue('');
    setFormSutId('');
    setFormEnv('');
    setFormTestType('');
    setSelectedSummary(null);
  };

  const handleCreate = async () => {
    if (!formTagKey.trim()) return;
    setSubmitting(true);
    try {
      const dto: CreateAlertTagFilterInput = {
        filterType,
        alertSource: formSource,
        tagKey: formTagKey.trim(),
        tagValue: formTagValue.trim() || undefined,
        systemUnderTestId: formSutId || undefined,
        testEnvironment: formEnv || undefined,
        testType: formTestType || undefined,
      };
      await createAlertTagFilter(dto);
      setSnackbar({ open: true, message: 'Filter created' });
      setCreateOpen(false);
      resetForm();
      loadFilters();
    } catch (err) {
      const msg = err && typeof err === 'object' && 'message' in err
        ? (err as Error).message : 'Failed to create filter';
      setSnackbar({ open: true, message: msg });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!filterToDelete) return;
    setDeleting(true);
    try {
      await deleteAlertTagFilter(filterToDelete.id);
      setSnackbar({ open: true, message: 'Filter deleted' });
      setDeleteOpen(false);
      setFilterToDelete(null);
      loadFilters();
    } catch (err) {
      const msg = err && typeof err === 'object' && 'message' in err
        ? (err as Error).message : 'Failed to delete filter';
      setSnackbar({ open: true, message: msg });
    } finally {
      setDeleting(false);
    }
  };

  const resolveSutName = (id?: string) => {
    if (!id) return 'All';
    return sutNameMap.get(id) ?? id;
  };

  return (
    <Box sx={{ py: 4, px: 3 }}>
      {/* Breadcrumbs */}
      <Breadcrumbs sx={{ mb: 2 }}>
        <Typography
          component={Link}
          href="/settings"
          color="text.secondary"
          sx={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 0.5, '&:hover': { color: 'primary.main' } }}
        >
          <ArrowBack sx={{ fontSize: 16 }} /> Settings
        </Typography>
        <Typography color="text.primary" sx={{ fontWeight: 600 }}>Alert Filters</Typography>
      </Breadcrumbs>

      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 700, color: 'text.primary', mb: 0.5 }}>
            Alert Filters
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Configure how alerts from Grafana and Alertmanager are processed
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => setCreateOpen(true)}
          sx={{ textTransform: 'none' }}
        >
          Add Filter
        </Button>
      </Box>

      {/* Tabs */}
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}
        >
          <Tab
            icon={<FilterAlt sx={{ fontSize: 18 }} />}
            iconPosition="start"
            label={`Omit Tags (${filters.filter(f => f.filterType === 'omit').length})`}
            sx={{ textTransform: 'none', minHeight: 48 }}
          />
          <Tab
            icon={<Block sx={{ fontSize: 18 }} />}
            iconPosition="start"
            label={`Abort Filters (${filters.filter(f => f.filterType === 'abort').length})`}
            sx={{ textTransform: 'none', minHeight: 48 }}
          />
        </Tabs>

        {loading ? (
          <Box display="flex" justifyContent="center" py={6}>
            <CircularProgress size={36} />
          </Box>
        ) : filteredList.length === 0 ? (
          <EmptyState type={filterType} />
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Alert Source</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>System Under Test</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Environment</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Test Type</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Tag Key</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Tag Value</TableCell>
                  <TableCell sx={{ fontWeight: 600, width: 60 }} align="center">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredList.map((filter) => (
                  <TableRow key={filter.id} hover>
                    <TableCell>
                      <Chip
                        label={filter.alertSource === 'grafana' ? 'Grafana' : 'Alertmanager'}
                        size="small"
                        color={filter.alertSource === 'grafana' ? 'warning' : 'error'}
                        variant="filled"
                        sx={{ fontSize: '0.7rem', height: 24 }}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {resolveSutName(filter.systemUnderTestId)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {filter.testEnvironment || 'All'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {filter.testType || 'All'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 500 }}>
                        {filter.tagKey}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                        {filter.tagValue || <Typography component="span" variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>any</Typography>}
                      </Typography>
                    </TableCell>
                    <TableCell align="center">
                      <IconButton
                        size="small"
                        onClick={() => { setFilterToDelete(filter); setDeleteOpen(true); }}
                        sx={{ color: 'error.main', '&:hover': { backgroundColor: 'error.light', color: 'error.contrastText' } }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      {/* Create Filter Dialog */}
      <Dialog open={createOpen} onClose={() => { setCreateOpen(false); resetForm(); }} maxWidth="sm" fullWidth>
        <DialogTitle>Create {filterType === 'omit' ? 'Omit Tag' : 'Abort'} Filter</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField
              select
              label="Alert Source"
              value={formSource}
              onChange={(e) => setFormSource(e.target.value as 'grafana' | 'alertmanager')}
              size="small"
              fullWidth
            >
              {ALERT_SOURCES.map((s) => (
                <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>
              ))}
            </TextField>

            <TextField
              select
              label="System Under Test"
              value={formSutId}
              onChange={(e) => {
                setFormSutId(e.target.value);
                setFormEnv('');
                setFormTestType('');
              }}
              size="small"
              fullWidth
              helperText="Leave empty to apply to all systems"
            >
              <MenuItem value="">All Systems</MenuItem>
              {systems.map((s) => (
                <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>
              ))}
            </TextField>

            <TextField
              select
              label="Environment"
              value={formEnv}
              onChange={(e) => {
                setFormEnv(e.target.value);
                setFormTestType('');
              }}
              size="small"
              fullWidth
              disabled={!formSutId}
              helperText={formSutId ? 'Leave empty to apply to all environments' : 'Select a system first'}
            >
              <MenuItem value="">All Environments</MenuItem>
              {environmentOptions.map((env) => (
                <MenuItem key={env} value={env}>{env}</MenuItem>
              ))}
            </TextField>

            <TextField
              select
              label="Test Type / Workload"
              value={formTestType}
              onChange={(e) => setFormTestType(e.target.value)}
              size="small"
              fullWidth
              disabled={!formEnv}
              helperText={formEnv ? 'Leave empty to apply to all workloads' : 'Select an environment first'}
            >
              <MenuItem value="">All Workloads</MenuItem>
              {workloadOptions.map((w) => (
                <MenuItem key={w} value={w}>{w}</MenuItem>
              ))}
            </TextField>

            <TextField
              label="Tag Key"
              value={formTagKey}
              onChange={(e) => setFormTagKey(e.target.value)}
              required
              size="small"
              fullWidth
              placeholder="e.g. severity, alertname"
            />
            <TextField
              label="Tag Value (leave empty to match any value)"
              value={formTagValue}
              onChange={(e) => setFormTagValue(e.target.value)}
              size="small"
              fullWidth
              placeholder="e.g. critical, HighCPU"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setCreateOpen(false); resetForm(); }} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleCreate} variant="contained" disabled={submitting || !formTagKey.trim()}>
            {submitting ? 'Creating...' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteOpen} onClose={() => { setDeleteOpen(false); setFilterToDelete(null); }}>
        <DialogTitle>Delete Filter</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete this {filterToDelete?.filterType} filter
            for tag &quot;{filterToDelete?.tagKey}&quot;
            {filterToDelete?.systemUnderTestId && <> on {resolveSutName(filterToDelete.systemUnderTestId)}</>}?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setDeleteOpen(false); setFilterToDelete(null); }} disabled={deleting}>
            Cancel
          </Button>
          <Button onClick={handleDelete} color="error" variant="contained" disabled={deleting}>
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        message={snackbar.message}
      />
    </Box>
  );
}
