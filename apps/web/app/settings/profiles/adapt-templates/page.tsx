'use client';

import { Suspense, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Alert, Box, Button, CircularProgress, Typography } from '@mui/material';
import { ArrowBack, Rule } from '@mui/icons-material';
import { useOrganizationContext } from '@/lib/contexts/organization-context';
import { parseScopeParams } from '@/lib/compare-templates';
import { TEMPLATE_REACH } from './components/CompareTemplateDialog';
import { AdaptTemplatesPanel } from './components/AdaptTemplatesPanel';
import { ScopeBadge } from './components/ScopeBadge';

/**
 * ADAPT (compare-config) templates of an organization (`?organizationId=`) or the install-wide ones
 * (`?scope=install`), reached from the two pinned entries on the profiles list. A profile's templates
 * are a tab on that profile's page, sharing the same `AdaptTemplatesPanel`.
 * Design: docs/design/2026-11-08-compare-config-templates-design.md §5.
 */
function AdaptTemplatesPage() {
  const router = useRouter();
  const params = useSearchParams();
  const scope = useMemo(() => parseScopeParams(params), [params]);
  const { organizations } = useOrganizationContext();

  const back = (
    <Button startIcon={<ArrowBack />} onClick={() => router.push('/settings/profiles')} sx={{ mb: 3, color: 'text.secondary' }}>
      Back to Profiles
    </Button>
  );

  if (!scope || scope.kind === 'profile') {
    return (
      <Box>
        {back}
        <Alert severity="warning">Open ADAPT templates from the profiles list: the page needs a scope.</Alert>
      </Box>
    );
  }

  const scopeName =
    scope.kind === 'install'
      ? 'All runs on this install'
      : `All runs in ${organizations.find((o) => o.id === scope.organizationId)?.name ?? scope.organizationId}`;

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
      </Box>
      <AdaptTemplatesPanel scope={scope} scopeName={scopeName} />
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
