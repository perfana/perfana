'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { Add, FileDownload, Rule } from '@mui/icons-material';
import { useOrganizationContext } from '@/lib/contexts/organization-context';
import {
  createCompareTemplate,
  deleteCompareTemplate,
  fetchCompareTemplates,
  updateCompareTemplate,
  type CompareTemplate,
  type CompareTemplateDefinition,
  type CompareTemplateList,
  type CompareTemplateScope,
} from '@/lib/compare-templates';
import { fetchProfiles, type Profile } from '@/lib/profiles';
import { CompareTemplateDialog } from './CompareTemplateDialog';
import { CompareTemplatesTable } from './CompareTemplatesTable';
import { CopyTemplateDialog, type CopyTarget } from './CopyTemplateDialog';
import { ExportTemplatesDialog } from './ExportTemplatesDialog';
import { describeKey } from '../template-display';

type Editing = { mode: 'new' } | { mode: 'edit' | 'view'; template: CompareTemplate };

const message = (err: unknown, fallback: string) =>
  err && typeof err === 'object' && 'message' in err ? (err as Error).message : fallback;

const sameScope = (a: CompareTemplateScope, b: CompareTemplateScope): boolean =>
  (a.kind === 'install' && b.kind === 'install') ||
  (a.kind === 'organization' && b.kind === 'organization' && a.organizationId === b.organizationId) ||
  (a.kind === 'profile' && b.kind === 'profile' && a.profileId === b.profileId);

/**
 * Every scope a template can be copied to but `scope`: the caller's profiles (by name), the selected
 * organization, the install-wide scope for a global admin, then the other organizations. A copy in
 * the same scope would have the same key, so it is never offered; the server refuses any target the
 * caller may not write.
 */
export function buildCopyTargets(
  scope: CompareTemplateScope,
  organizations: Array<{ id: string; name: string }>,
  profiles: Array<Pick<Profile, 'id' | 'name'>>,
  isAdmin: boolean,
  currentOrganizationId: string | null | undefined,
): CopyTarget[] {
  const orgTargets: CopyTarget[] = organizations.map((o) => ({
    key: o.id,
    label: `All runs in ${o.name}`,
    scope: { kind: 'organization', organizationId: o.id },
  }));
  const profileTargets: CopyTarget[] = [...profiles]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((p) => ({ key: `profile:${p.id}`, label: `Profile ${p.name}`, scope: { kind: 'profile', profileId: p.id } }));
  const install: CopyTarget[] = isAdmin
    ? [{ key: 'install', label: 'All runs on this install (install-wide)', scope: { kind: 'install' } }]
    : [];
  const selected = orgTargets.filter((t) => t.key === currentOrganizationId);
  const others = orgTargets.filter((t) => t.key !== currentOrganizationId);
  return [...profileTargets, ...selected, ...install, ...others].filter((t) => !sameScope(t.scope, scope));
}

interface AdaptTemplatesPanelProps {
  scope: CompareTemplateScope;
  /** How the dialog names the scope, e.g. "All runs in Acme" or "Profile jvm". */
  scopeName: string;
}

/**
 * The templates of one scope: the table, the add/edit/view dialog, copy to another scope, delete, and,
 * on the install-wide scope for a global admin, Export YAML. Shared by the organization and install-wide
 * page (`/settings/profiles/adapt-templates`) and the profile page's ADAPT templates tab.
 */
export function AdaptTemplatesPanel({ scope, scopeName }: AdaptTemplatesPanelProps) {
  const { organizations, isAdmin, currentOrganizationId } = useOrganizationContext();

  const [list, setList] = useState<CompareTemplateList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [copying, setCopying] = useState<CompareTemplate | null>(null);
  const [deleting, setDeleting] = useState<CompareTemplate | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; severity: 'success' | 'error' } | null>(null);

  const load = useCallback(async () => {
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

  // Profiles are copy targets only; a failure just leaves them out of the list.
  useEffect(() => {
    let cancelled = false;
    fetchProfiles()
      .then((p) => {
        if (!cancelled) setProfiles(p);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const copyTargets = useMemo(
    () => buildCopyTargets(scope, organizations, profiles, isAdmin, currentOrganizationId),
    [scope, organizations, profiles, isAdmin, currentOrganizationId],
  );

  const handleSave = async (definition: CompareTemplateDefinition) => {
    if (!editing) return;
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

  const canWrite = list?.canWrite === true;
  const provisionedCount = list?.templates.filter((t) => t.readOnly).length ?? 0;
  const showExport = scope.kind === 'install' && isAdmin;

  return (
    <Box>
      {(showExport || canWrite) && (
        <Box display="flex" justifyContent="flex-end" gap={1} mb={2}>
          {showExport && (
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
      )}

      {scope.kind === 'install' && !isAdmin && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Install-wide templates apply to every organization&rsquo;s runs, so only a global admin can change them.
        </Alert>
      )}
      {list && !canWrite && scope.kind !== 'install' && (
        <Alert severity="info" sx={{ mb: 2 }}>
          You can view these templates; changing them needs the SLO management permission in{' '}
          {scope.kind === 'profile' ? 'the profile’s' : 'this'} organization.
        </Alert>
      )}
      {provisionedCount > 0 && (
        <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
          {provisionedCount} template{provisionedCount === 1 ? ' is' : 's are'} provisioned from <code>template_ds_compare_configs.yaml</code> and
          locked here. Change {provisionedCount === 1 ? 'it' : 'them'} in the file, or copy to another scope to edit a copy.
        </Alert>
      )}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Card variant={scope.kind === 'profile' ? 'outlined' : 'elevation'}>
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
                {canWrite ? 'Add one to classify a panel the same way on every workload it reaches.' : 'Nothing is configured here yet.'}
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

      {showExport && <ExportTemplatesDialog open={exportOpen} onClose={() => setExportOpen(false)} />}

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
