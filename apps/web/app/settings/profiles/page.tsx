'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Box,
  Typography,
  Card,
  CardContent,
  CircularProgress,
  Alert,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  Button,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  Tune,
  Lock,
  Add,
  Rule,
  Edit,
} from '@mui/icons-material';
import { fetchProfiles, createProfile, updateProfile, Profile } from '@/lib/profiles';
import { useOrganizationContext } from '@/lib/contexts/organization-context';
import { fetchCompareTemplates, templatesPageHref, type CompareTemplateScope } from '@/lib/compare-templates';
import { ScopeBadge } from './adapt-templates/components/ScopeBadge';
import { ProfileFormDialog, type ProfileFormValues } from './components/ProfileFormDialog';
import { visibleProfileTags } from './profile-tags';

/** How many templates a pinned entry holds, or `null` while unknown. */
type TemplateCount = { total: number; provisioned: number } | null;

function templateCountText(count: TemplateCount): string {
  if (!count) return '–';
  if (count.total === 0) return 'No ADAPT templates';
  const n = `${count.total} ADAPT template${count.total === 1 ? '' : 's'}`;
  return count.provisioned > 0 ? `${n} (${count.provisioned} provisioned)` : n;
}

async function countTemplates(scope: CompareTemplateScope): Promise<TemplateCount> {
  try {
    const list = await fetchCompareTemplates(scope);
    return { total: list.templates.length, provisioned: list.templates.filter((t) => t.readOnly).length };
  } catch {
    return null;
  }
}

export default function ProfilesPage() {
  const router = useRouter();
  const { currentOrganizationId, currentOrganization } = useOrganizationContext();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [orgTemplates, setOrgTemplates] = useState<TemplateCount>(null);
  const [installTemplates, setInstallTemplates] = useState<TemplateCount>(null);
  const [loading, setLoading] = useState(true);
  // `error` is the page's own: loading the list failed. A failed SAVE goes to `formError`, which
  // renders inside the dialog — see ProfileFormDialog's `error` prop.
  const [error, setError] = useState<string>('');
  const [formError, setFormError] = useState<string>('');
  const [formOpen, setFormOpen] = useState(false);
  // null while creating; the profile being edited otherwise.
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [saving, setSaving] = useState(false);

  // Memoized so the dialog's `options` memo can actually hold: the page re-renders on dialog
  // state, saving and errors, none of which change `profiles`.
  const tagSuggestions = useMemo(() => profiles.flatMap((p) => p.tags ?? []), [profiles]);

  const loadProfiles = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchProfiles(currentOrganizationId || undefined);
      setProfiles(data);
      setError('');
    } catch (err) {
      setError(
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to load profiles'
      );
    } finally {
      setLoading(false);
    }
  }, [currentOrganizationId]);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  // The pinned ADAPT template entries' counts. A failure leaves the count unknown, never blocks the list.
  useEffect(() => {
    let cancelled = false;
    void countTemplates({ kind: 'install' }).then((c) => !cancelled && setInstallTemplates(c));
    if (currentOrganizationId) {
      void countTemplates({ kind: 'organization', organizationId: currentOrganizationId }).then((c) => !cancelled && setOrgTemplates(c));
    } else {
      setOrgTemplates(null);
    }
    return () => {
      cancelled = true;
    };
  }, [currentOrganizationId]);

  /**
   * Two pinned entries that open the ADAPT templates without a profile (design §5): one for every run
   * in the selected organization, shown to its members, and one for every run on the install.
   */
  const pinnedTemplateEntries: Array<{ key: string; label: string; detail: string; kind: 'organization' | 'install'; scope: CompareTemplateScope; count: TemplateCount }> = [
    ...(currentOrganizationId
      ? [{
          key: 'organization',
          label: `All runs in ${currentOrganization?.name ?? 'this organization'}`,
          detail: 'ADAPT templates for every run in this organization',
          kind: 'organization' as const,
          scope: { kind: 'organization', organizationId: currentOrganizationId } as CompareTemplateScope,
          count: orgTemplates,
        }]
      : []),
    {
      key: 'install',
      label: 'All runs on this install',
      detail: 'ADAPT templates for every run, in every organization',
      kind: 'install' as const,
      scope: { kind: 'install' },
      count: installTemplates,
    },
  ];

  const openCreate = () => {
    setEditingProfile(null);
    setFormError('');
    setFormOpen(true);
  };

  const openEdit = (profile: Profile) => {
    setEditingProfile(profile);
    setFormError('');
    setFormOpen(true);
  };

  const handleSubmitProfile = async (values: ProfileFormValues) => {
    try {
      setSaving(true);
      setFormError('');
      if (editingProfile) {
        // NO `name` key, ever. The field is read-only, but the dialog still trims what it holds,
        // and a profile stored with a padded name (`POST /profiles` does not trim, and it is a
        // CI/CD provisioning endpoint) would have the trimmed form sent back — which the API
        // reads as a rename, orphaning the dashboards and deep links that key on the old name.
        // `updateProfile` applies `if (dto.name !== undefined)`, so omitting it is a no-op.
        const storedDescription = editingProfile.description ?? '';
        await updateProfile(editingProfile.id, {
          // Sent only when it actually changed. `''` is what clears it — `undefined` would be
          // dropped by `JSON.stringify` and the API's `!== undefined` guard would keep the old
          // text — but sending it unchanged rewrites a description nobody edited and puts a
          // spurious diff in `audit_logs` on every tags-only edit.
          //
          // Compared and sent TRIMMED, matching the create branch. Raw, typing only spaces into
          // an empty description stored `'   '`, which is truthy, so the list cell rendered blank
          // instead of its `-` placeholder — and it stuck, because the next open compared `'   '`
          // against `'   '` and never resent it.
          ...(values.description.trim() !== storedDescription.trim()
            ? { description: values.description.trim() }
            : {}),
          // Always send the array, even empty: that is how clearing every tag persists.
          tags: values.tags,
        });
      } else {
        // Create in the organization the list above is showing, so the new profile appears in it
        // and its ADAPT templates reach that organization's runs. With none selected the API
        // picks one.
        await createProfile({
          name: values.name,
          // Trimmed and omitted when blank, so a new profile stores NULL rather than `''`.
          description: values.description.trim() || undefined,
          // Omitted when empty, so a profile created without tags stores NULL rather than an
          // empty array — the shape every profile created before this field had.
          tags: values.tags.length > 0 ? values.tags : undefined,
          organizationId: currentOrganizationId || undefined,
        });
      }
      setFormOpen(false);
      setEditingProfile(null);
      await loadProfiles();
    } catch (err) {
      // Into the DIALOG, not the page: the dialog stays open holding the edit, and the page
      // behind it is covered by the backdrop and `aria-hidden` while it does.
      setFormError(
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : editingProfile
            ? 'Failed to update profile'
            : 'Failed to create profile'
      );
    } finally {
      setSaving(false);
    }
  };

  const _formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress size={40} />
      </Box>
    );
  }

  return (
    <Box>
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={3}>
        <Box display="flex" alignItems="center" gap={2}>
          <Tune sx={{ fontSize: 32, color: 'primary.main' }} />
          <Typography variant="h4" component="h1">
            Profiles
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={openCreate}
        >
          Add Profile
        </Button>
      </Box>

      <ProfileFormDialog
        open={formOpen}
        profile={editingProfile}
        tagSuggestions={tagSuggestions}
        saving={saving}
        error={formError}
        onClose={() => {
          setFormOpen(false);
          setEditingProfile(null);
          setFormError('');
        }}
        onSubmit={handleSubmitProfile}
      />

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      <Card>
        <CardContent>
          <TableContainer component={Paper} variant="outlined">
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>
                    <Typography variant="subtitle2" fontWeight={600}>
                      Name
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="subtitle2" fontWeight={600}>
                      Description
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="subtitle2" fontWeight={600}>
                      Tags
                    </Typography>
                  </TableCell>
                  <TableCell align="center">
                    <Typography variant="subtitle2" fontWeight={600}>
                      Dashboards
                    </Typography>
                  </TableCell>
                  <TableCell align="center">
                    <Typography variant="subtitle2" fontWeight={600}>
                      SLOs
                    </Typography>
                  </TableCell>
                  <TableCell align="center">
                    <Typography variant="subtitle2" fontWeight={600}>
                      Deep Links
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="subtitle2" fontWeight={600}>
                      Actions
                    </Typography>
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pinnedTemplateEntries.map((entry) => (
                  <TableRow
                    key={`pinned-${entry.key}`}
                    hover
                    data-testid={`pinned-adapt-templates-${entry.key}`}
                    onClick={() => router.push(templatesPageHref(entry.scope))}
                    sx={{ cursor: 'pointer', bgcolor: 'action.hover' }}
                  >
                    <TableCell>
                      <Box display="flex" alignItems="center" gap={1}>
                        <Rule color="primary" fontSize="small" />
                        <Typography variant="body2" fontWeight={600}>
                          {entry.label}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell colSpan={2}>
                      <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                        <ScopeBadge kind={entry.kind} />
                        <Typography variant="body2" color="text.secondary">
                          {entry.detail}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell colSpan={4} align="center">
                      <Typography variant="body2" fontWeight={500}>
                        {templateCountText(entry.count)}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
                {profiles.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <Box textAlign="center" py={4}>
                        <Tune sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
                        <Typography variant="h6" color="text.secondary" gutterBottom>
                          No profiles found
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          There are currently no profiles in the system.
                        </Typography>
                      </Box>
                    </TableCell>
                  </TableRow>
                )}
                {profiles.map((profile) => (
                  <TableRow
                    key={profile.id}
                    hover
                    onClick={() => router.push(`/settings/profiles/${profile.id}`)}
                    sx={{
                      '&:last-child td, &:last-child th': { border: 0 },
                      cursor: 'pointer',
                      transition: 'background-color 0.2s ease',
                      '&:hover': {
                        backgroundColor: 'rgba(25, 118, 210, 0.04)',
                      },
                    }}
                  >
                    <TableCell>
                      <Box display="flex" alignItems="center" gap={1}>
                        <Tune color="primary" fontSize="small" />
                        <Typography variant="body2" fontWeight={500}>
                          {profile.name}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{
                          maxWidth: 300,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {profile.description || '-'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Box display="flex" gap={0.5} flexWrap="wrap">
                        {profile.readOnly && (
                          <Chip
                            icon={<Lock fontSize="small" />}
                            label="Provisioned"
                            size="small"
                            sx={{
                              height: '28px',
                              background: (theme) =>
                                theme.palette.mode === 'dark'
                                  ? 'linear-gradient(135deg, rgba(255, 213, 79, 0.15) 0%, rgba(255, 193, 7, 0.20) 100%)'
                                  : 'linear-gradient(135deg, rgba(255, 193, 7, 0.1) 0%, rgba(255, 193, 7, 0.2) 100%)',
                              border: (theme) =>
                                theme.palette.mode === 'dark'
                                  ? '1px solid rgba(255, 213, 79, 0.4)'
                                  : '1px solid rgba(255, 193, 7, 0.3)',
                              color: (theme) =>
                                theme.palette.mode === 'dark' ? '#ffd54f' : '#f57f17',
                              fontWeight: 600,
                              backdropFilter: 'blur(8px)',
                              transition: 'all 0.2s ease',
                              '& .MuiChip-icon': {
                                color: 'rgba(255, 193, 7, 0.7)',
                                marginLeft: '4px'
                              },
                              '&:hover': {
                                transform: 'translateY(-1px)',
                                boxShadow: '0 4px 12px rgba(255, 193, 7, 0.3)',
                                borderColor: 'rgba(255, 193, 7, 0.5)',
                                '& .MuiChip-icon': {
                                  color: 'rgba(255, 193, 7, 1)'
                                }
                              },
                              '& .MuiChip-label': {
                                px: 1.5,
                                py: 0,
                                fontSize: '0.75rem'
                              }
                            }}
                          />
                        )}
                        {(() => {
                          const filteredTags = visibleProfileTags(profile.tags);
                          return filteredTags.length > 0 ? (
                            filteredTags.map((tag, index) => (
                              <Chip
                                key={index}
                                label={tag}
                                size="small"
                                sx={{
                                  height: '28px',
                                  background: (theme) =>
                                    theme.palette.mode === 'dark'
                                      ? 'linear-gradient(135deg, rgba(100, 181, 246, 0.15) 0%, rgba(66, 165, 245, 0.20) 100%)'
                                      : 'linear-gradient(135deg, rgba(25, 118, 210, 0.1) 0%, rgba(25, 118, 210, 0.2) 100%)',
                                  border: (theme) =>
                                    theme.palette.mode === 'dark'
                                      ? '1px solid rgba(100, 181, 246, 0.4)'
                                      : '1px solid rgba(25, 118, 210, 0.3)',
                                  color: (theme) =>
                                    theme.palette.mode === 'dark' ? '#90caf9' : theme.palette.primary.dark,
                                  fontWeight: 600,
                                  backdropFilter: 'blur(8px)',
                                  transition: 'all 0.2s ease',
                                  '&:hover': {
                                    transform: 'translateY(-1px)',
                                    boxShadow: '0 4px 12px rgba(25, 118, 210, 0.2)',
                                    borderColor: (theme) =>
                                      theme.palette.mode === 'dark'
                                        ? 'rgba(100, 181, 246, 0.6)'
                                        : 'rgba(25, 118, 210, 0.4)',
                                  },
                                  '& .MuiChip-label': {
                                    px: 1.5,
                                    py: 0,
                                    fontSize: '0.75rem'
                                  }
                                }}
                              />
                            ))
                          ) : !profile.readOnly ? (
                            <Typography variant="caption" color="text.secondary">
                              No tags
                            </Typography>
                          ) : null;
                        })()}
                      </Box>
                    </TableCell>
                    <TableCell align="center">
                      <Typography variant="body2" fontWeight={500}>
                        {profile.dashboardCount}
                      </Typography>
                    </TableCell>
                    <TableCell align="center">
                      <Typography variant="body2" fontWeight={500}>
                        {profile.sloCount}
                      </Typography>
                    </TableCell>
                    <TableCell align="center">
                      <Typography variant="body2" fontWeight={500}>
                        {profile.deepLinksCount}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip
                        title={
                          profile.readOnly
                            ? 'Provisioned profiles cannot be edited'
                            : 'Edit description and tags'
                        }
                      >
                        {/* Focusable ONLY when the button is disabled: a disabled button cannot
                            take focus, so without this the reason would be pointer-only. On an
                            enabled row the button takes focus itself, and a focusable wrapper
                            there is just a dead tab stop per profile. The click guard is for the
                            disabled case too — MUI sets `pointer-events: none` on a disabled
                            button, so the click lands here and would bubble to the row's
                            navigation, silently taking the user elsewhere. */}
                        <span
                          tabIndex={profile.readOnly ? 0 : -1}
                          onClick={(e) => e.stopPropagation()}
                          style={{ display: 'inline-flex' }}
                        >
                          <IconButton
                            size="small"
                            disabled={profile.readOnly}
                            data-testid={`edit-profile-${profile.id}`}
                            aria-label={
                              profile.readOnly
                                ? `${profile.name} is provisioned and cannot be edited`
                                : `Edit ${profile.name}`
                            }
                            onClick={(e) => {
                              // The row navigates to the profile; the button must not.
                              e.stopPropagation();
                              openEdit(profile);
                            }}
                          >
                            <Edit fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>
    </Box>
  );
}
