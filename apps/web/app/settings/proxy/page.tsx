'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Button,
  TextField,
  Snackbar,
  CircularProgress,
  Paper,
  Breadcrumbs,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Alert,
} from '@mui/material';
import {
  ArrowBack,
  Router as ProxyIcon,
  Save,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import Link from 'next/link';
import { authenticatedFetch } from '@/lib/api';

interface ProxyConfig {
  id: string;
  proxyUrl: string;
  username?: string;
  hasPassword: boolean;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
}

export default function ProxySettingsPage() {
  const [config, setConfig] = useState<ProxyConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Form fields
  const [proxyUrl, setProxyUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const [snackbar, setSnackbar] = useState({ open: false, message: '' });

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authenticatedFetch('/proxy');
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? `HTTP ${res.status}`);
      }
      const data: ProxyConfig | null = await res.json();
      if (!data) {
        // 200 + null means no proxy is configured — show an empty form
        setConfig(null);
        setProxyUrl('');
        setUsername('');
        setPassword('');
        return;
      }
      setConfig(data);
      setProxyUrl(data.proxyUrl);
      setUsername(data.username ?? '');
      setPassword('');
    } catch (err) {
      const msg = err && typeof err === 'object' && 'message' in err
        ? (err as Error).message : 'Failed to load proxy configuration';
      setSnackbar({ open: true, message: msg });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const handleSave = async () => {
    if (!proxyUrl.trim()) return;
    setSaving(true);
    try {
      const body: { proxyUrl: string; username?: string; password?: string } = {
        proxyUrl: proxyUrl.trim(),
      };
      if (username.trim()) body.username = username.trim();
      // Only include password if the user actually typed something
      if (password) body.password = password;

      const res = await authenticatedFetch('/proxy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? `HTTP ${res.status}`);
      }

      const data: ProxyConfig = await res.json();
      setConfig(data);
      setProxyUrl(data.proxyUrl);
      setUsername(data.username ?? '');
      setPassword('');
      setSnackbar({ open: true, message: 'Proxy configuration saved' });
    } catch (err) {
      const msg = err && typeof err === 'object' && 'message' in err
        ? (err as Error).message : 'Failed to save proxy configuration';
      setSnackbar({ open: true, message: msg });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await authenticatedFetch('/proxy', { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? `HTTP ${res.status}`);
      }
      setConfig(null);
      setProxyUrl('');
      setUsername('');
      setPassword('');
      setDeleteOpen(false);
      setSnackbar({ open: true, message: 'Proxy configuration deleted' });
    } catch (err) {
      const msg = err && typeof err === 'object' && 'message' in err
        ? (err as Error).message : 'Failed to delete proxy configuration';
      setSnackbar({ open: true, message: msg });
    } finally {
      setDeleting(false);
    }
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
        <Typography color="text.primary" sx={{ fontWeight: 600 }}>Proxy</Typography>
      </Breadcrumbs>

      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 40,
              height: 40,
              borderRadius: '8px',
              background: 'linear-gradient(135deg, rgba(0, 150, 136, 0.1) 0%, rgba(0, 150, 136, 0.05) 100%)',
              color: 'rgba(0, 150, 136, 1)',
            }}
          >
            <ProxyIcon />
          </Box>
          <Box>
            <Typography variant="h4" component="h1" sx={{ fontWeight: 700, color: 'text.primary', mb: 0.5 }}>
              Proxy
            </Typography>
            <Typography variant="body1" color="text.secondary">
              Configure an outbound proxy server for integrations
            </Typography>
          </Box>
        </Box>
      </Box>

      {loading ? (
        <Box display="flex" justifyContent="center" py={6}>
          <CircularProgress size={36} />
        </Box>
      ) : (
        <Paper variant="outlined" sx={{ borderRadius: 2, p: 3, maxWidth: 600 }}>
          {/* Info banner */}
          <Alert severity="info" sx={{ mb: 3 }}>
            Once configured, this proxy can be enabled per integration on the Integrations page.
          </Alert>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            <TextField
              label="Proxy URL"
              value={proxyUrl}
              onChange={(e) => setProxyUrl(e.target.value)}
              required
              size="small"
              fullWidth
              placeholder="http://proxy.company.com:3128"
              helperText="The full URL of the proxy server, including protocol and port"
              disabled={saving}
            />

            <TextField
              label="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              size="small"
              fullWidth
              placeholder="optional"
              helperText="Leave blank if the proxy does not require authentication"
              disabled={saving}
            />

            <TextField
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              size="small"
              fullWidth
              placeholder={config?.hasPassword ? '••••••••' : 'optional'}
              helperText={
                config?.hasPassword
                  ? 'A password is currently set. Leave blank to keep the current password.'
                  : 'Leave blank if no password is required'
              }
              disabled={saving}
            />

            <Box sx={{ display: 'flex', gap: 2, pt: 1 }}>
              <Button
                variant="contained"
                startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <Save />}
                onClick={handleSave}
                disabled={saving || !proxyUrl.trim()}
                sx={{ textTransform: 'none' }}
              >
                {saving ? 'Saving...' : 'Save'}
              </Button>

              {config && (
                <Button
                  variant="outlined"
                  color="error"
                  startIcon={<DeleteIcon />}
                  onClick={() => setDeleteOpen(true)}
                  disabled={saving || deleting}
                  sx={{ textTransform: 'none' }}
                >
                  Delete
                </Button>
              )}
            </Box>
          </Box>
        </Paper>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)}>
        <DialogTitle>Delete Proxy Configuration</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete the proxy configuration for{' '}
            <strong>{config?.proxyUrl}</strong>? Integrations that rely on this proxy
            will no longer be able to route traffic through it.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteOpen(false)} disabled={deleting}>
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
