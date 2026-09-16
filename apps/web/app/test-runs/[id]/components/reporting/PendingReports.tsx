'use client';

/**
 * Polls every report the page is waiting on and shows one progress row each.
 *
 * One slot used to hold one id: a second report started while the first was still
 * rendering replaced it, the first poll was cancelled, and that report never opened
 * the viewer or toasted — it just turned up in the list later. Each pending id now has
 * its own poll; the panel stays up until every one of them is ready or has failed.
 */

import React, { useEffect, useState } from 'react';
import { LinearProgress, Paper, Snackbar, Typography } from '@mui/material';
import { getReport } from '@/lib/api/reports';

interface Progress { percent: number; label: string }

interface PendingReportsProps {
  ids: string[];
  /** The HTML is ready: open it. */
  onReady: (reportId: string) => void;
  /** Ready, failed or given up on: stop tracking it. */
  onSettled: (reportId: string) => void;
  showToast: (message: string) => void;
}

// A large report (many graph/trend presets, several runs of history) takes minutes,
// not the 60 s this used to allow before giving up on the viewer.
const MAX_POLLS = 600;
const POLL_MS = 1000;

/** Poll one report until it settles, reporting its progress up. */
function usePendingReport(
  reportId: string,
  onProgress: (p: Progress) => void,
  onReady: (reportId: string) => void,
  onSettled: (reportId: string) => void,
  showToast: (message: string) => void,
) {
  useEffect(() => {
    let cancelled = false;
    let polls = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    onProgress({ percent: 0, label: 'Starting…' });

    const settle = (message?: string) => {
      if (message) showToast(message);
      onSettled(reportId);
    };
    const poll = async () => {
      try {
        const report = await getReport(reportId);
        if (cancelled) return;
        if (report.status === 'html_complete' || report.status === 'pdf_complete') {
          onReady(report.id);
          settle('Report ready');
          return;
        }
        if (report.status === 'failed') {
          settle('Report generation failed');
          return;
        }
        const p = report.progress;
        if (p?.total) {
          onProgress({ percent: p.percent, label: `Rendering section ${(p.done ?? 0) + 1} of ${p.total}${p.section ? `: ${p.section}` : ''}` });
        } else if (report.status === 'pending') {
          onProgress({ percent: 0, label: 'Waiting for a worker…' });
        }
      } catch (error) {
        if (cancelled) return;
        console.error('Failed to poll report:', error);
      }
      if (++polls < MAX_POLLS) {
        timer = setTimeout(poll, POLL_MS);
      } else {
        settle('Report generation is taking longer than expected');
      }
    };
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
    // Callbacks are stable page handlers; the poll belongs to the id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId]);
}

function PendingReport({ id, onProgress, ...rest }: {
  id: string;
  onProgress: (id: string, p: Progress) => void;
  onReady: (reportId: string) => void;
  onSettled: (reportId: string) => void;
  showToast: (message: string) => void;
}) {
  usePendingReport(id, (p) => onProgress(id, p), rest.onReady, rest.onSettled, rest.showToast);
  return null;
}

export default function PendingReports({ ids, onReady, onSettled, showToast }: PendingReportsProps) {
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const onProgress = (id: string, next: Progress) =>
    // Same value, same object: a poll that learned nothing must not re-render the page.
    setProgress(prev => {
      const cur = prev[id];
      return cur && cur.percent === next.percent && cur.label === next.label ? prev : { ...prev, [id]: next };
    });

  return (
    <>
      {ids.map(id => (
        <PendingReport key={id} id={id} onProgress={onProgress} onReady={onReady} onSettled={onSettled} showToast={showToast} />
      ))}
      <Snackbar open={ids.length > 0} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        <Paper elevation={6} sx={{ p: 2, minWidth: 320 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            Generating {ids.length === 1 ? 'report' : `${ids.length} reports`}…
          </Typography>
          {ids.map(id => {
            const p = progress[id];
            return (
              <React.Fragment key={id}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, mb: 0.5 }}>
                  {p?.label ?? 'Starting…'}
                </Typography>
                <LinearProgress variant={p && p.percent > 0 ? 'determinate' : 'indeterminate'} value={p?.percent ?? 0} />
              </React.Fragment>
            );
          })}
        </Paper>
      </Snackbar>
    </>
  );
}
