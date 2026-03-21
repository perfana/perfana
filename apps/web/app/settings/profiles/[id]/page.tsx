'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  Box, Typography, Card, CardContent, Divider, CircularProgress,
  Alert, Tabs, Tab, Button, Snackbar, Dialog, DialogTitle, DialogContent,
  DialogContentText, DialogActions,
} from '@mui/material';
import { Tune, ArrowBack, Add as AddIcon, Delete as DeleteIcon } from '@mui/icons-material';
import { deleteProfile } from '@/lib/profiles';
import { SnackbarState } from './types';
import { useProfileData, useGrafanaData, useDashboards, useBenchmarks } from './hooks';
import {
  ProfileDashboardsTable, DashboardFormDialog, ProfileBenchmarksTable,
  BenchmarkFormDialog, TabPanel, BatchDeleteDialog, ProfileTagChips,
} from './components';

const ADD_BUTTON_SX = {
  background: 'linear-gradient(135deg, rgba(25, 118, 210, 0.9) 0%, rgba(30, 136, 229, 0.9) 100%)',
  '&:hover': { background: 'linear-gradient(135deg, rgba(25, 118, 210, 1) 0%, rgba(30, 136, 229, 1) 100%)' },
};

export default function ProfileDetailsPage() {
  const router = useRouter();
  const params = useParams();
  const profileId = params.id as string;

  const [activeTab, setActiveTab] = useState(0);
  const [snackbar, setSnackbar] = useState<SnackbarState>({ open: false, message: '', severity: 'success' });
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const handleSnackbar = (state: SnackbarState) => setSnackbar(state);

  const { profile, loading, error } = useProfileData({ profileId });
  const grafanaData = useGrafanaData();
  const dashboardsHook = useDashboards({ profileId, onSnackbar: handleSnackbar, loadGrafanaData: grafanaData.loadGrafanaData });
  const benchmarksHook = useBenchmarks({ profileId, onSnackbar: handleSnackbar });

  useEffect(() => {
    if (activeTab === 0 && profile && dashboardsHook.dashboards.length === 0 && !dashboardsHook.loading && !dashboardsHook.error) {
      dashboardsHook.loadDashboards();
    }
    if (activeTab === 1 && profile && benchmarksHook.benchmarks.length === 0 && !benchmarksHook.loading && !benchmarksHook.error) {
      benchmarksHook.loadBenchmarks();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, profile]);

  const handleBack = () => router.push('/settings/profiles');
  const handleSnackbarClose = () => setSnackbar(prev => ({ ...prev, open: false }));

  const handleDeleteProfile = async () => {
    try {
      setDeleting(true);
      await deleteProfile(profileId);
      router.push('/settings/profiles');
    } catch (err) {
      setDeleteDialogOpen(false);
      setSnackbar({
        open: true,
        message: err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to delete profile',
        severity: 'error',
      });
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px"><CircularProgress size={40} /></Box>;
  }

  if (error || !profile) {
    return (
      <Box>
        <Button startIcon={<ArrowBack />} onClick={handleBack} sx={{ mb: 3 }}>Back to Profiles</Button>
        <Alert severity={error ? 'error' : 'warning'}>{error || 'Profile not found'}</Alert>
      </Box>
    );
  }

  return (
    <Box>
      <Button startIcon={<ArrowBack />} onClick={handleBack} sx={{ mb: 3, color: 'text.secondary', '&:hover': { color: 'primary.main', backgroundColor: 'rgba(25, 118, 210, 0.08)' } }}>
        Back to Profiles
      </Button>

      <Box display="flex" alignItems="center" gap={2} mb={3}>
        <Tune sx={{ fontSize: 40, color: 'primary.main' }} />
        <Box flex={1}>
          <Typography variant="h4" component="h1" gutterBottom>{profile.name}</Typography>
          {profile.description && <Typography variant="body1" color="text.secondary">{profile.description}</Typography>}
        </Box>
        {!profile.readOnly && (
          <Button
            variant="outlined"
            color="error"
            startIcon={<DeleteIcon />}
            onClick={() => setDeleteDialogOpen(true)}
          >
            Delete Profile
          </Button>
        )}
      </Box>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>Profile Information</Typography>
          <Divider sx={{ mb: 2 }} />
          <Box>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>Tags</Typography>
            <ProfileTagChips tags={profile.tags} readOnly={profile.readOnly} />
          </Box>
        </CardContent>
      </Card>

      <Card>
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} aria-label="profile tabs"
            sx={{ px: 2, '& .MuiTab-root': { textTransform: 'none', fontSize: '1rem', fontWeight: 500, minHeight: 64 }, '& .MuiTabs-indicator': { height: 3, borderRadius: '3px 3px 0 0' } }}>
            <Tab label="Dashboards" id="profile-tab-0" aria-controls="profile-tabpanel-0" />
            <Tab label="Service Level Objectives" id="profile-tab-1" aria-controls="profile-tabpanel-1" />
            <Tab label="Deep Links" id="profile-tab-2" aria-controls="profile-tabpanel-2" />
          </Tabs>
        </Box>
        <CardContent>
          <TabPanel value={activeTab} index={0}>
            <Box mb={2}>
              <Button variant="contained" startIcon={<AddIcon />} onClick={dashboardsHook.handleAdd} sx={ADD_BUTTON_SX}>Add Dashboard</Button>
            </Box>
            <ProfileDashboardsTable dashboards={dashboardsHook.dashboards} loading={dashboardsHook.loading} error={dashboardsHook.error}
              selectedDashboardIds={dashboardsHook.selectedIds} onEdit={dashboardsHook.handleEdit} onDelete={dashboardsHook.handleDelete}
              onSelectAll={dashboardsHook.handleSelectAll} onSelectOne={dashboardsHook.handleSelectOne}
              onBatchDelete={() => dashboardsHook.setBatchDeleteDialogOpen(true)} />
          </TabPanel>
          <TabPanel value={activeTab} index={1}>
            <Box mb={2}>
              <Button variant="contained" startIcon={<AddIcon />} onClick={benchmarksHook.handleAdd} sx={ADD_BUTTON_SX}>Add Service Level Objective</Button>
            </Box>
            <ProfileBenchmarksTable benchmarks={benchmarksHook.benchmarks} loading={benchmarksHook.loading} error={benchmarksHook.error}
              selectedBenchmarkIds={benchmarksHook.selectedIds} onEdit={benchmarksHook.handleEdit} onDelete={benchmarksHook.handleDelete}
              onSelectAll={benchmarksHook.handleSelectAll} onSelectOne={benchmarksHook.handleSelectOne}
              onBatchDelete={() => benchmarksHook.setBatchDeleteDialogOpen(true)} />
          </TabPanel>
          <TabPanel value={activeTab} index={2}>
            <Box sx={{ textAlign: 'center', py: 8, borderRadius: 1, border: '1px dashed', borderColor: 'divider' }}>
              <Typography variant="h6" color="text.secondary" gutterBottom>Deep Links</Typography>
              <Typography variant="body2" color="text.secondary">Deep links management content coming soon</Typography>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 2 }}>
                This tab will show the {profile.deepLinksCount} deep link{profile.deepLinksCount !== 1 ? 's' : ''} associated with this profile
              </Typography>
            </Box>
          </TabPanel>
        </CardContent>
      </Card>

      <DashboardFormDialog open={dashboardsHook.formDialogOpen} mode={dashboardsHook.formMode} dashboard={dashboardsHook.editingDashboard}
        availableDashboards={grafanaData.dashboards} availableInstances={grafanaData.instances} loading={grafanaData.loading}
        onClose={() => dashboardsHook.setFormDialogOpen(false)} onSubmit={dashboardsHook.handleFormSubmit} />
      <BenchmarkFormDialog open={benchmarksHook.formDialogOpen} mode={benchmarksHook.formMode} benchmark={benchmarksHook.editingBenchmark}
        profileDashboards={dashboardsHook.dashboards} loading={false}
        onClose={() => benchmarksHook.setFormDialogOpen(false)} onSubmit={benchmarksHook.handleFormSubmit} />
      <BatchDeleteDialog open={dashboardsHook.batchDeleteDialogOpen} itemCount={dashboardsHook.selectedIds.size} itemType="dashboard"
        onClose={() => dashboardsHook.setBatchDeleteDialogOpen(false)} onConfirm={dashboardsHook.handleBatchDelete} />
      <BatchDeleteDialog open={benchmarksHook.batchDeleteDialogOpen} itemCount={benchmarksHook.selectedIds.size} itemType="SLO"
        onClose={() => benchmarksHook.setBatchDeleteDialogOpen(false)} onConfirm={benchmarksHook.handleBatchDelete} />

      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>Delete Profile</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete the profile <strong>{profile.name}</strong>? This will also remove all associated dashboards, SLOs, and deep links. This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleDeleteProfile} color="error" variant="contained" disabled={deleting}>
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={snackbar.open} autoHideDuration={6000} onClose={handleSnackbarClose} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert onClose={handleSnackbarClose} severity={snackbar.severity} sx={{ width: '100%' }}>{snackbar.message}</Alert>
      </Snackbar>
    </Box>
  );
}
