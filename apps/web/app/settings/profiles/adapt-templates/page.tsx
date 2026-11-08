'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Snackbar,
  Typography,
} from '@mui/material';
import { Add, ArrowBack, FileDownload, Rule } from '@mui/icons-material';
import { useOrganizationContext } from '@/lib/contexts/organization-context';
import {
  createCompareTemplate,
  deleteCompareTemplate,
  fetchCompareTemplates,
  parseScopeParams,
  updateCompareTemplate,
  type CompareTemplate,
  type CompareTemplateDefinition,
  type CompareTemplateList,
} from '@/lib/compare-templates';
import { CompareTemplateDialog, TEMPLATE_REACH } from './components/CompareTemplateDialog';
import { CompareTemplatesTable } from './components/CompareTemplatesTable';
import { CopyTemplateDialog, type CopyTarget } from './components/CopyTemplateDialog';
import { ExportTemplatesDialog } from './components/ExportTemplatesDialog';
import { ScopeBadge } from './components/ScopeBadge';
import { describeKey } from './template-display';

type Editing = { mode: 'new' } | { mode: 'edit' | 'view'; template: CompareTemplate };

const message = (err: unknown, fallback: string) =>
  err && typeof err === 'object' && 'message' in err ? (err as Error).message : fallback;

/**
 * ADAPT (compare-config) templates of one scope: an organization's (`?organizationId=`) or the
 * install-wide ones (`?scope=install`), reached from the two pinned entries on the profiles list.
 * Design: docs/design/2026-11-08-compare-config-templates-design.md §5. Profile templates, the
 * design's third scope, follow in a later PR.
 */
function AdaptTemplatesPage() {
  const router = useRouter();
  const params = useSearchParams();
  const scope = useMemo(() => parseScopeParams(params), [params]);
  const { organizations, isAdmin, currentOrganizationId } = useOrganizationContext();

  const [list, setList] = useState<CompareTemplateList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [copying, setCopying] = useState<CompareTemplate | null>(null);
  const [deleting, setDeleting] = useState<CompareTemplate | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; severity: 'success' | 'error' } | null>(null);

  const organizationName = useCallback(
    (id: string) => organizations.find((o) => o.id === id)?.name ?? id,
    [organizations],
  );
  const scopeName = !scope
    ? ''
    : scope.kind === 'install'
      ? 'All runs on this install'
      : `All runs in ${organizationName(scope.organizationId)}`;

  const load = useCallback(async () => {
    if (!scope) return;
    setLoading(true);
    try {
      setList(await fetchCompareTemplates(scope));
      setError(null);
    } catch (err) {
      setError(message(err, 'Failed to load ADAPT templates'));
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Every scope but this one, the selected organization first; the server refuses a copy the caller
   * may not write.
   */
  const copyTargets = useMemo<CopyTarget[]>(() => {
    if (!scope) return [];
    const orgTargets: CopyTarget[] = organizations
      .filter((o) => !(scope.kind === 'organization' && scope.organizationId === o.id))
      .map((o) => ({ key: o.id, label: `All runs in ${o.name}`, scope: { kind: 'organization', organizationId: o.id } }));
    const selected = orgTargets.filter((t) => t.key === currentOrganizationId);
    const others = orgTargets.filter((t) => t.key !== currentOrganizationId);
    const install: CopyTarget[] =
      isAdmin && scope.kind !== 'install'
        ? [{ key: 'install', label: 'All runs on this install (install-wide)', scope: { kind: 'install' } }]
        : [];
    return [...selected, ...install, ...others];
  }, [scope, organizations, isAdmin, currentOrganizationId]);

  const handleSave = async (definition: CompareTemplateDefinition) => {
    if (!scope || !editing) return;
    if (editing.mode === 'new') {
      await createCompareTemplate(scope, definition);
      setToast({ message: 'Template created. It applies on the next completed run of matching workloads.', severity: 'success' });
    } else {
      await updateCompareTemplate(editing.template.id, definition);
      setToast({ message: 'Template saved. It applies on the next completed run of matching workloads.', severity: 'success' });
    }
    setEditing(null);
    await load();
  };

  const handleCopy = async (target: CopyTarget) => {
    if (!copying) return;
    await createCompareTemplate(target.scope, copying.definition);
    setCopying(null);
    setToast({ message: `Copied to ${target.label}.`, severity: 'success' });
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await deleteCompareTemplate(deleting.id);
      setDeleting(null);
      setToast({ message: 'Template deleted.', severity: 'success' });
      await load();
    } catch (err) {
      setToast({ message: message(err, 'Failed to delete the template'), severity: 'error' });
    } finally {
      setDeleteBusy(false);
    }
  };

  const back = (
    <Button startIcon={<ArrowBack />} onClick={() => router.push('/settings/profiles')} sx={{ mb: 3, color: 'text.secondary' }}>
      Back to Profiles
    </Button>
  );

  if (!scope) {
    return (
      <Box>
        {back}
        <Alert severity="warning">Open ADAPT templates from the profiles list: the page needs a scope.</Alert>
      </Box>
    );
  }

  const canWrite = list?.canWrite === true;
  const provisionedCount = list?.templates.filter((t) => t.readOnly).length ?? 0;

  return (
    <Box>
      {back}
      <Box display="flex" alignItems="flex-start" gap={2} mb={3} flexWrap="wrap">
        <Rule sx={{ fontSize: 40, color: 'primary.main' }} />
        <Box flex={1} minWidth={280}>
          <Box display="flex" alignItems="center" gap={1.5} flexWrap="wrap">
            <Typography variant="h4" component="h1">ADAPT templates</Typography>
            <ScopeBadge kind={scope.kind} />
          </Box>
          <Typography variant="h6" component="p" color="text.secondary" sx={{ mt: 0.5 }}>{scopeName}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1, maxWidth: 900 }}>
            A template sets ADAPT&rsquo;s comparison settings (classification, direction, thresholds) for matching panels on every workload
            {scope.kind === 'install' ? ' on this install, in every organization' : ' in this organization'}. {TEMPLATE_REACH}
          </Typography>
        </Box>
        <Box display="flex" gap={1}>
          {scope.kind === 'install' && isAdmin && (
            <Button variant="outlined" startIcon={<FileDownload />} onClick={() => setExportOpen(true)}>
              Export YAML
            </Button>
          )}
          {canWrite && (
            <Button variant="contained" startIcon={<Add />} onClick={() => setEditing({ mode: 'new' })}>
              Add template
            </Button>
          )}
        </Box>
      </Box>

      {scope.kind === 'install' && !isAdmin && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Install-wide templates apply to every organization&rsquo;s runs, so only a global admin can change them.
        </Alert>
      )}
      {list && !canWrite && scope.kind === 'organization' && (
        <Alert severity="info" sx={{ mb: 2 }}>You can view this organization&rsquo;s templates; changing them needs the SLO management permission.</Alert>
      )}
      {provisionedCount > 0 && (
        <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
          {provisionedCount} template{provisionedCount === 1 ? ' is' : 's are'} provisioned from <code>template_ds_compare_configs.yaml</code> and
          locked here. Change {provisionedCount === 1 ? 'it' : 'them'} in the file, or copy to another scope to edit a copy.
        </Alert>
      )}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Card>
        <CardContent>
          {loading && !list ? (
            <Box display="flex" justifyContent="center" py={6}>
              <CircularProgress size={32} />
            </Box>
          ) : list && list.templates.length === 0 ? (
            <Box textAlign="center" py={6}>
              <Rule sx={{ fontSize: 56, color: 'text.secondary', mb: 1 }} />
              <Typography variant="h6" color="text.secondary" gutterBottom>No ADAPT templates in this scope</Typography>
              <Typography variant="body2" color="text.secondary">
                {canWrite ? 'Add one to classify a panel the same way on every workload.' : 'Nothing is configured here yet.'}
              </Typography>
            </Box>
          ) : list ? (
            <CompareTemplatesTable
              templates={list.templates}
              canWrite={canWrite}
              canCopy={copyTargets.length > 0}
              onEdit={(template) => setEditing({ mode: 'edit', template })}
              onView={(template) => setEditing({ mode: 'view', template })}
              onCopy={setCopying}
              onDelete={setDeleting}
            />
          ) : null}
        </CardContent>
      </Card>

      <CompareTemplateDialog
        open={editing !== null}
        scopeKind={scope.kind}
        scopeName={scopeName}
        initial={editing && editing.mode !== 'new' ? editing.template.definition : undefined}
        readOnly={editing?.mode === 'view'}
        onClose={() => setEditing(null)}
        onSave={handleSave}
      />

      <CopyTemplateDialog
        open={copying !== null}
        targets={copyTargets}
        provisioned={copying?.readOnly === true}
        onClose={() => setCopying(null)}
        onCopy={handleCopy}
      />

      <Dialog open={deleting !== null} onClose={deleteBusy ? undefined : () => setDeleting(null)} aria-labelledby="delete-template-title">
        <DialogTitle id="delete-template-title">Delete this ADAPT template?</DialogTitle>
        <DialogContent>
          <DialogContentText component="div">
            {deleting && (
              <Typography variant="body2" sx={{ mb: 1, fontWeight: 500 }}>{describeKey(deleting.definition)}</Typography>
            )}
            <Typography variant="body2">
              On each workload&rsquo;s next completed run, the panels this template configured go to the next matching template, or back to
              their own configuration from before any template. Panels someone edited by hand are not touched.
            </Typography>
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleting(null)} disabled={deleteBusy}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleDelete} disabled={deleteBusy}>
            {deleteBusy ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      {scope.kind === 'install' && isAdmin && <ExportTemplatesDialog open={exportOpen} onClose={() => setExportOpen(false)} />}

      <Snackbar
        open={toast !== null}
        autoHideDuration={5000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {toast ? <Alert severity={toast.severity} onClose={() => setToast(null)} variant="filled">{toast.message}</Alert> : undefined}
      </Snackbar>
    </Box>
  );
}

export default function AdaptTemplatesRoute() {
  return (
    <Suspense
      fallback={
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
          <CircularProgress size={40} />
        </Box>
      }
    >
      <AdaptTemplatesPage />
    </Suspense>
  );
}
