/**
 * Number formatting for the Analyst chart standard.
 *
 * Two formatters, deliberately: `fv` for the values in the series table (fixed rules so a
 * column of numbers lines up), `ft` for axis tick labels (compact, trailing zeros
 * dropped). Neither appends a unit — the unit is printed once, on the axis.
 */

/** What an absent or unusable value prints as. One em dash, never '0'. */
export const EMPTY = '—';

const grouped = (value: number): string =>
  Math.round(value).toLocaleString('en-US', { maximumFractionDigits: 0 });

/**
 * A table value. Decimals by magnitude so the column reads as one number:
 * ≥1000 grouped integer, ≥100 → 0 decimals, ≥10 → 1, ≥1 → 2, else 3.
 */
export function fv(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY;
  const abs = Math.abs(value);
  if (abs >= 1000) return grouped(value);
  if (abs >= 100) return value.toFixed(0);
  if (abs >= 10) return value.toFixed(1);
  if (abs >= 1) return value.toFixed(2);
  if (value === 0) return '0';
  return value.toFixed(3);
}

/** A tick label. Same magnitude rules as `fv`, with trailing zeros dropped. */
export function ft(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  const fixed = fv(value);
  // Only a decimal form has zeros worth dropping; a grouped integer has commas.
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
}

/**
 * The nearest 1/2/5 × 10ⁿ at or above `raw`. Used to give the right-hand axis the same
 * number of ticks as the left one, so the two tick sets sit on the same gridlines
 * instead of interleaving into visual noise.
 */
export function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const normalized = raw / magnitude;
  // 2.5 is in the set so a 4-tick axis over ~95 reads 0/25/50/75/100 rather than
  // collapsing to 0/50/100.
  const step =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

/** Tick values 0, step, 2·step … up to and just past `max`. */
export function tickValues(max: number, count: number): number[] {
  if (!Number.isFinite(max) || max <= 0 || count < 1) return [0];
  const step = niceStep(max / count);
  const out: number[] = [];
  for (let v = 0; v <= max + step / 2; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

/** `HH:MM:SS` — the cursor readout in Graphs. */
export const fmtClock = (time: string | number | Date): string => {
  const date = new Date(time);
  return Number.isNaN(date.getTime())
    ? EMPTY
    : date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

/** `HH:MM` — x-axis ticks in Graphs. Wall-clock, no −45° labels to decode. */
export const fmtHM = (time: string | number | Date): string => {
  const date = new Date(time);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

/**
 * `04 Oct` — x-axis ticks in Trends, where a position is a run rather than an instant.
 * `en-GB` pins day-before-month, so a reader never has to guess whether `04/10` is
 * October or April.
 */
export const fmtDay = (time: string | number | Date): string => {
  const date = new Date(time);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
};

/** `04 Oct 14:30` — the same tick when one day holds more than one run. */
export const fmtDayHM = (time: string | number | Date): string => {
  const date = new Date(time);
  return Number.isNaN(date.getTime()) ? '' : `${fmtDay(date)} ${fmtHM(date)}`;
};
