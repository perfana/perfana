'use client';

import { Alert, AlertTitle, Typography } from '@mui/material';

/**
 * Shared by the two Apdex threshold dialogs (Performance Analysis "Set Baseline
 * Apdex" and the SLO "Configure Apdex Thresholds"). Both call the same preview
 * endpoint, so both hit the same minimum-sample rule and both need to explain it.
 *
 * The API's only reachable reason for achievable:false is the sample minimum —
 * at a threshold of ceil(max response time) every sample is Satisfied, so the
 * target is mathematically reachable for any transaction that has data. Anything
 * else here would be a bug, so the notice stays honest by counting the two cases
 * separately and only offering the "lower it" advice when lowering would help.
 */
interface Item {
  achievable: boolean;
  sample_count: number;
}

interface ApdexUnachievableNoticeProps {
  items: Item[];
  minSamples: number;
  /** Below this a calculated threshold is a ballpark; used for the caveat only. */
  defaultMinSamples: number;
}

export function ApdexUnachievableNotice({
  items,
  minSamples,
  defaultMinSamples,
}: ApdexUnachievableNoticeProps) {
  const unachievable = items.filter((i) => !i.achievable);
  if (unachievable.length === 0) return null;

  const lowSample = unachievable.filter((i) => i.sample_count < minSamples);
  // The smallest minimum that would bring at least one of them in.
  const wouldInclude = lowSample.length
    ? Math.max(...lowSample.map((i) => i.sample_count))
    : 0;
  const gained = lowSample.filter((i) => i.sample_count >= wouldInclude).length;

  return (
    <Alert severity="warning" sx={{ mt: 2 }}>
      <AlertTitle>
        {unachievable.length} transaction{unachievable.length === 1 ? '' : 's'} without a
        calculated threshold
      </AlertTitle>

      {lowSample.length > 0 && (
        <Typography variant="body2" component="div">
          {lowSample.length === unachievable.length
            ? 'They all have'
            : `${lowSample.length} of them have`}{' '}
          fewer than <strong>{minSamples}</strong> successful samples in this test run, which is
          the minimum used to calculate a threshold. That is normal for a low-volume
          transaction, for one that mostly failed, and for one whose calls are split across
          several scenarios.
          {wouldInclude > 0 && (
            <>
              {' '}
              Lower <strong>Min samples</strong> to <strong>{wouldInclude}</strong> and
              recalculate to include {gained === 1 ? 'one of them' : `${gained} of them`}.
            </>
          )}{' '}
          Below {defaultMinSamples} samples the result is a ballpark: the Apdex score moves in
          steps of 0.5/n, so a single slow call shifts the threshold. Round the number up and
          check it against the next run.
        </Typography>
      )}

      {lowSample.length < unachievable.length && (
        <Typography variant="body2" sx={{ mt: lowSample.length ? 1 : 0 }}>
          {unachievable.length - lowSample.length} have enough samples but still could not be
          calculated — hover the status chip for the reason the server gave.
        </Typography>
      )}
    </Alert>
  );
}

export default ApdexUnachievableNotice;
