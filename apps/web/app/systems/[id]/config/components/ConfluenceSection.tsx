'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Paper, Stack, TextField, Typography } from '@mui/material';
import { Save as SaveIcon } from '@mui/icons-material';
import type { SystemUnderTest } from '@/types/test-runs';
import { fetchConfluenceConfigs, type ConfluenceConfig } from '@/lib/confluence';
import { updateSystemUnderTest } from '@/lib/systems';

interface ConfluenceSectionProps {
  systemUnderTest: SystemUnderTest;
  onUpdate: (system: SystemUnderTest) => void;
}

/** "A / B / C" as the API stores it, so an unchanged field does not read as an edit. */
const normalizePath = (path: string): string =>
  path.split('/').map((t) => t.trim()).filter(Boolean).join(' / ');

/**
 * Per-system Confluence parent pages: for each connection of the system's organization, a page path
 * below that connection's own parent page. Missing levels are created on publish.
 */
export default function ConfluenceSection({ systemUnderTest, onUpdate }: ConfluenceSectionProps) {
  const stored = useMemo(() => systemUnderTest.confluence_parent_pages ?? {}, [systemUnderTest.confluence_parent_pages]);
  const [configs, setConfigs] = useState<ConfluenceConfig[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [paths, setPaths] = useState<Record<string, string>>(stored);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => setPaths(stored), [stored]);

  useEffect(() => {
    let cancelled = false;
    // A report can only be published with a connection of its own organization.
    fetchConfluenceConfigs(systemUnderTest.organization_id)
      .then((c) => { if (!cancelled) setConfigs(c); })
      .catch((err: unknown) => { if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load Confluence connections'); });
    return () => { cancelled = true; };
  }, [systemUnderTest.organization_id]);

  const dirty = (configs ?? []).some((c) => normalizePath(paths[c.id] ?? '') !== (stored[c.id] ?? ''));

  const save = async () => {
    if (!systemUnderTest.id) return;
    setSaving(true);
    setResult(null);
    try {
      // Keep entries for connections not listed here (another organization's, or deleted ones are
      // harmless), and replace the listed ones with what is in the form.
      const next: Record<string, string> = { ...stored };
      for (const c of configs ?? []) {
        const p = normalizePath(paths[c.id] ?? '');
        if (p) next[c.id] = p; else delete next[c.id];
      }
      const saved = await updateSystemUnderTest(systemUnderTest.id, { confluence_parent_pages: next });
      // The PATCH answers with the entity, not the summary the page holds: merge only this field.
      onUpdate({ ...systemUnderTest, confluence_parent_pages: saved.confluence_parent_pages ?? next });
      setResult({ ok: true, message: 'Saved' });
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : 'Failed to save Confluence parent pages' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Paper sx={{ p: 3 }}>
      <Typography variant="h6" gutterBottom>Confluence parent page</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Reports of this system are published under this page path, below the connection&apos;s own parent page.
        Separate levels with <code>/</code>, for example <code>Performance / {systemUnderTest.name}</code>.
        Pages that do not exist yet are created on the next publish. Leave a field empty to publish under the
        connection&apos;s parent page. A report published before keeps its page where it is.
      </Typography>

      {loadError && <Alert severity="error">{loadError}</Alert>}
      {!loadError && configs === null && <CircularProgress size={24} />}
      {configs?.length === 0 && (
        <Alert severity="info">This system&apos;s organization has no Confluence connection. Add one on the Integrations page.</Alert>
      )}

      {configs && configs.length > 0 && (
        <Stack spacing={2.5}>
          {configs.map((c) => (
            <TextField
              key={c.id}
              label={`${c.label} (space ${c.spaceKey})`}
              value={paths[c.id] ?? ''}
              onChange={(e) => setPaths((prev) => ({ ...prev, [c.id]: e.target.value }))}
              placeholder={`Performance / ${systemUnderTest.name}`}
              helperText={c.parentPageId
                ? `Created below page ${c.parentPageId}, the connection's parent page`
                : 'Created at the root of the space, the connection has no parent page'}
              fullWidth
              size="small"
              inputProps={{ maxLength: 2000 }}
            />
          ))}
          {result && <Alert severity={result.ok ? 'success' : 'error'} role="status">{result.message}</Alert>}
          <Box>
            <Button variant="contained" startIcon={<SaveIcon />} onClick={save} disabled={!dirty || saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </Box>
        </Stack>
      )}
    </Paper>
  );
}
