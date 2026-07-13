'use client';

import { useState } from 'react';
import {
  Box,
  Stack,
  Typography,
  Paper,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  CircularProgress,
  List,
  ListItem,
  ListItemText,
  Divider,
} from '@mui/material';
import {
  UploadFile as UploadFileIcon,
  FileUpload as FileUploadIcon,
  Lock as LockIcon,
} from '@mui/icons-material';
import { useAuth } from '@/contexts/auth-context';
import { GLOBAL_ADMIN_ROLES } from '@/lib/constants/roles';
import { env } from '@/lib/env';
import { authenticatedFetch } from '@/lib/api';
import { useOrganizations } from '@/lib/hooks/use-organizations';

interface ImportSummary {
  sutId: string;
  sutName: string;
  rowCounts: Record<string, number>;
}

export default function SutImportPage() {
  const { hasAnyRole } = useAuth();
  const isGlobalAdmin = hasAnyRole(Array.from(GLOBAL_ADMIN_ROLES));
  const { data: orgs = [] } = useOrganizations({ enabled: env.SUT_TRANSFER_ENABLED && isGlobalAdmin });

  const [file, setFile] = useState<File | null>(null);
  const [targetOrg, setTargetOrg] = useState('');
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!env.SUT_TRANSFER_ENABLED || !isGlobalAdmin) {
    return (
      <Box sx={{ py: 4, px: 3 }}>
        <Alert severity="warning" icon={<LockIcon fontSize="inherit" />}>
          This page is not available. SUT import requires admin access and the feature must be enabled.
        </Alert>
      </Box>
    );
  }

  const doImport = async () => {
    if (!file || !targetOrg) return;
    setBusy(true);
    setError(null);
    setSummary(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('targetOrganizationId', targetOrg);
      const res = await authenticatedFetch('/systems-under-test/import', {
        method: 'POST',
        body: form,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error((data && data.message) || res.statusText || 'Import failed');
      }
      setSummary(data as ImportSummary);
      setFile(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ py: 4, px: 3 }}>
      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 0.5 }}>
          <FileUploadIcon sx={{ color: 'primary.main' }} />
          <Typography variant="h4" component="h1" sx={{ fontWeight: 700, color: 'text.primary' }}>
            Import System Under Test
          </Typography>
        </Stack>
        <Typography variant="body1" color="text.secondary">
          Upload a previously exported <code>.ndjson.gz</code> bundle and assign it to a target organization.
        </Typography>
      </Box>

      <Paper variant="outlined" sx={{ p: 3, borderRadius: 2, maxWidth: 560 }}>
        <Stack spacing={2.5}>
          <Button
            component="label"
            variant="outlined"
            startIcon={<UploadFileIcon />}
            disabled={busy}
            sx={{ alignSelf: 'flex-start', textTransform: 'none' }}
          >
            {file ? file.name : 'Choose bundle file…'}
            <input
              type="file"
              accept=".gz,.ndjson.gz"
              hidden
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </Button>

          <FormControl size="small" fullWidth disabled={busy}>
            <InputLabel id="target-org-label">Target organization</InputLabel>
            <Select
              labelId="target-org-label"
              label="Target organization"
              value={targetOrg}
              onChange={(e) => setTargetOrg(e.target.value)}
            >
              <MenuItem value="">
                <em>Select target organization…</em>
              </MenuItem>
              {orgs.map((o) => (
                <MenuItem key={o.id} value={o.id}>
                  {o.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Button
            variant="contained"
            onClick={doImport}
            disabled={busy || !file || !targetOrg}
            sx={{ alignSelf: 'flex-start', textTransform: 'none' }}
          >
            {busy ? <CircularProgress size={20} color="inherit" /> : 'Import'}
          </Button>

          {error && <Alert severity="error" role="alert">{error}</Alert>}

          {summary && (
            <Alert severity="success">
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
                Imported &ldquo;{summary.sutName}&rdquo;.
              </Typography>
              <Divider sx={{ mb: 1 }} />
              <List dense disablePadding>
                {Object.entries(summary.rowCounts).map(([table, count]) => (
                  <ListItem key={table} disablePadding sx={{ py: 0.25 }}>
                    <ListItemText
                      primary={table}
                      secondary={count}
                      primaryTypographyProps={{ variant: 'body2' }}
                      secondaryTypographyProps={{ variant: 'body2', sx: { textAlign: 'right' } }}
                      sx={{ display: 'flex', justifyContent: 'space-between' }}
                    />
                  </ListItem>
                ))}
              </List>
            </Alert>
          )}
        </Stack>
      </Paper>
    </Box>
  );
}
