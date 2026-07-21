'use client';

import { buildSystemConfigUrl } from '@/lib/system-config-url';
import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Box,
  Card,
  CardContent,
  Collapse,
  Divider,
  CircularProgress,
  Alert,
  Typography,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  ExpandMore,
  ExpandLess,
  Settings,
} from '@mui/icons-material';
import KPIDisplay from '../shared/KPIDisplay';
import SoftBadge from '../shared/SoftBadge';
import { DeepLinkItem, DeepLinkDialog, DeepLinksFilters } from './components';
import { useDeepLinksData } from './hooks';
import { ResolvedDeepLink } from './types';

interface DeepLinksCardProps {
  testRun: {
    test_run_id: string;
    system_under_test_id: string;
    test_environment: string;
    workload: string;
  };
  expanded: boolean;
  onExpand: () => void;
}

export default function DeepLinksCard({ testRun, expanded, onExpand }: DeepLinksCardProps) {
  const { test_run_id: testRunId, system_under_test_id: systemUnderTestId, test_environment: testEnvironment, workload } = testRun;
  const router = useRouter();
  const cardRef = useRef<HTMLDivElement>(null);

  const [previewLink, setPreviewLink] = useState<ResolvedDeepLink | null>(null);
  const [searchText, setSearchText] = useState('');
  const [activeTags, setActiveTags] = useState<string[]>([]);

  const { loading, error, resolvedLinks, validCount, invalidCount } = useDeepLinksData({
    testRunId,
    systemUnderTestId,
    testEnvironment,
    workload,
  });

  // Derive the full set of tags across all links (sorted, deduplicated)
  const availableTags = Array.from(
    new Set(resolvedLinks.flatMap((l) => l.tags ?? [])),
  ).sort();

  // OR filter: link must match text search AND have at least one active tag
  const filteredLinks = resolvedLinks.filter((l) => {
    const matchesText =
      searchText === '' ||
      l.name.toLowerCase().includes(searchText.toLowerCase()) ||
      l.url.toLowerCase().includes(searchText.toLowerCase());
    const matchesTags = activeTags.length === 0 || activeTags.some((t) => l.tags?.includes(t));
    return matchesText && matchesTags;
  });

  const handleTagToggle = (tag: string) => {
    setActiveTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  const accentColor: 'warning' | 'primary' = !loading && invalidCount > 0 ? 'warning' : 'primary';

  const handleExpand = () => {
    const wasCollapsed = !expanded;
    onExpand();
    if (wasCollapsed) {
      setTimeout(() => {
        const el = document.querySelector('[data-testid="deep-links-card-expanded"]');
        if (el) (el as HTMLElement).focus({ preventScroll: true });
      }, 300);
    }
  };

  const handleConfigClick = () => {
    router.push(
      buildSystemConfigUrl({ systemId: systemUnderTestId, tab: '2', environment: testEnvironment, workload, fromTestRun: testRunId }),
    );
  };

  return (
    <Box>
      <Card
        ref={cardRef}
        tabIndex={-1}
        data-testid={expanded ? 'deep-links-card-expanded' : 'deep-links-card-collapsed'}
        elevation={0}
        sx={{
          cursor: expanded ? 'default' : 'pointer',
          height: expanded ? 'auto' : '293px',
          borderRadius: 3,
          bgcolor: 'background.paper',
          border: 'none',
          borderTop: expanded ? 'none' : '3px solid',
          borderTopColor: expanded ? 'transparent' : `${accentColor}.main`,
          boxShadow: (theme) =>
            theme.palette.mode === 'dark'
              ? '0 1px 3px rgba(0,0,0,0.3), 0 4px 12px rgba(0,0,0,0.2)'
              : '0 1px 3px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.04)',
          transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          position: 'relative',
          overflow: expanded ? 'visible' : 'hidden',
          '&:hover': expanded
            ? {}
            : {
                transform: 'translateY(-4px)',
                boxShadow: (theme) =>
                  theme.palette.mode === 'dark'
                    ? '0 4px 12px rgba(0,0,0,0.4), 0 8px 24px rgba(0,0,0,0.3)'
                    : '0 4px 12px rgba(0,0,0,0.1), 0 8px 24px rgba(0,0,0,0.08)',
              },
        }}
        onClick={expanded ? undefined : handleExpand}
      >
        <CardContent
          sx={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            p: 3.5,
            pt: 4,
            '&:last-child': { pb: 3.5 },
          }}
        >
          {/* ── Header ───────────────────────────────────────── */}
          {expanded ? (
            <Box
              mb={2.5}
              sx={{
                py: 1,
                px: 1.25,
                mx: -1.25,
                borderRadius: 2,
                transition: 'background-color 0.2s ease',
                position: 'sticky',
                top: 0,
                zIndex: 10,
                bgcolor: 'background.paper',
                borderBottom: '1px solid',
                borderColor: 'divider',
                cursor: 'pointer',
                '&:hover': { backgroundColor: 'action.hover' },
              }}
              onClick={handleExpand}
            >
              <Box textAlign="center">
                <Typography
                  variant="h5"
                  component="h2"
                  sx={{
                    fontWeight: 600,
                    color: 'text.primary',
                    fontSize: '1.25rem',
                    lineHeight: 1.2,
                  }}
                >
                  Deep Links
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Click to collapse
                </Typography>
              </Box>
              <Tooltip title="Configure deep links" arrow>
                <IconButton
                  size="small"
                  onClick={(e) => { e.stopPropagation(); handleConfigClick(); }}
                  sx={{
                    position: 'absolute',
                    right: 40,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'text.secondary',
                    '&:hover': { color: 'primary.main', backgroundColor: 'action.hover' },
                  }}
                >
                  <Settings fontSize="small" />
                </IconButton>
              </Tooltip>
              <IconButton
                onClick={(e) => { e.stopPropagation(); handleExpand(); }}
                size="small"
                sx={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 32,
                  height: 32,
                  color: 'text.secondary',
                  '&:hover': {
                    backgroundColor: (theme) => `${theme.palette[accentColor].main}15`,
                    color: `${accentColor}.main`,
                  },
                  transition: 'all 0.2s ease',
                }}
              >
                <ExpandLess />
              </IconButton>
            </Box>
          ) : (
            <Box
              display="flex"
              justifyContent="center"
              alignItems="center"
              mb={2}
              sx={{ position: 'relative' }}
            >
              <Typography
                variant="subtitle1"
                component="h2"
                sx={{
                  fontWeight: 600,
                  color: 'text.secondary',
                  fontSize: '0.875rem',
                  letterSpacing: '0.01em',
                  textTransform: 'uppercase',
                  textAlign: 'center',
                }}
              >
                Deep Links
              </Typography>
              <IconButton
                onClick={(e) => { e.stopPropagation(); handleExpand(); }}
                size="small"
                sx={{
                  position: 'absolute',
                  right: 0,
                  width: 32,
                  height: 32,
                  color: 'text.secondary',
                  '&:hover': {
                    backgroundColor: (theme) => `${theme.palette[accentColor].main}15`,
                    color: `${accentColor}.main`,
                  },
                  transition: 'all 0.2s ease',
                }}
              >
                <ExpandMore />
              </IconButton>
            </Box>
          )}

          {/* ── Collapsed content ────────────────────────────── */}
          {!expanded && (
            <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
              <Box sx={{ py: 1 }}>
                <KPIDisplay
                  value={loading ? '—' : error ? 'Error' : resolvedLinks.length}
                  label="External Links"
                  loading={loading}
                />
              </Box>

              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, justifyContent: 'center' }}>
                {loading && <SoftBadge label="Loading links…" color="blue" />}

                {!loading && !error && resolvedLinks.length > 0 && (
                  <>
                    {resolvedLinks
                      .filter((l) => l.isValid)
                      .slice(0, 2)
                      .map((l) => (
                        <SoftBadge
                          key={l.id}
                          label={l.name}
                          color="blue"
                          onClick={(e) => { e.stopPropagation(); window.open(l.url, '_blank', 'noopener,noreferrer'); }}
                        />
                      ))}
                    {validCount > 2 && (
                      <SoftBadge count={validCount - 2} label="more" color="blue" />
                    )}
                    {invalidCount > 0 && (
                      <SoftBadge count={invalidCount} label="unresolved" color="orange" />
                    )}
                  </>
                )}

                {!loading && !error && resolvedLinks.length === 0 && (
                  <SoftBadge label="No links configured" color="neutral" />
                )}
              </Box>
            </Box>
          )}

          {/* ── Expanded content ─────────────────────────────── */}
          <Collapse in={expanded}>
            <Divider sx={{ my: 2 }} />

            {loading ? (
              <Box textAlign="center" py={4}>
                <CircularProgress size={32} />
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  Loading deep links…
                </Typography>
              </Box>
            ) : error ? (
              <Alert severity="error">{error}</Alert>
            ) : resolvedLinks.length === 0 ? (
              <Box textAlign="center" py={4}>
                <Typography variant="body2" color="text.secondary">
                  No deep links configured for this test run.
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                  Configure deep links in{' '}
                  <Box
                    component="span"
                    onClick={handleConfigClick}
                    sx={{ color: 'primary.main', cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    system settings
                  </Box>
                  .
                </Typography>
              </Box>
            ) : (
              <>
                <DeepLinksFilters
                  searchText={searchText}
                  onSearchChange={setSearchText}
                  availableTags={availableTags}
                  activeTags={activeTags}
                  onTagToggle={handleTagToggle}
                  totalCount={resolvedLinks.length}
                  filteredCount={filteredLinks.length}
                />

                {filteredLinks.length === 0 ? (
                  <Box textAlign="center" py={3}>
                    <Typography variant="body2" color="text.secondary">
                      No links match the current filters.
                    </Typography>
                  </Box>
                ) : (
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: {
                        xs: '1fr',
                        sm: 'repeat(2, 1fr)',
                        md: 'repeat(3, 1fr)',
                        lg: 'repeat(4, 1fr)',
                      },
                      gap: 2,
                    }}
                  >
                    {filteredLinks.map((link) => (
                      <DeepLinkItem
                        key={link.id}
                        link={link}
                        onPreview={setPreviewLink}
                        onOpenInNewTab={(l) => window.open(l.url, '_blank', 'noopener,noreferrer')}
                      />
                    ))}
                  </Box>
                )}
              </>
            )}
          </Collapse>
        </CardContent>
      </Card>

      {/* ── Modal preview ────────────────────────────────────── */}
      <DeepLinkDialog link={previewLink} onClose={() => setPreviewLink(null)} />
    </Box>
  );
}
