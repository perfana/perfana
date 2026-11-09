/**
 * Unit mapping utility based on Grafana unit formats
 * Maps yAxesFormat values to human-readable units
 */

interface Unit {
  name: string;
  id: string;
  format: string;
  /**
   * The unit family this code belongs to — the set of codes that measure the same
   * quantity and therefore share ONE axis. A code with no family is its own family: a
   * `reqps` series and an `ops` series are both rates but are not interchangeable, and
   * stacking them on one axis reads as a single quantity that it is not.
   */
  family?: string;
  /** Multiplier to the family's base unit (seconds for `time`, bytes for `data`, 0-100 for `pct`). */
  factor?: number;
}

const KiB = 1024;

const units: Unit[] = [
  { name: '', id: 'none', format: '' },
  { name: '', id: 'short', format: '' },
  { name: '%', id: 'percent', format: '%', family: 'pct', factor: 1 },
  { name: 'Percent (0.0-1.0)', id: 'percentunit', format: '%', family: 'pct', factor: 100 },
  { name: 'Humidity (%H)', id: 'humidity', format: '%H' },
  { name: 'Decibel', id: 'dB', format: 'dB' },
  { name: 'bytes(IEC)', id: 'bytes', format: 'B', family: 'data', factor: 1 },
  { name: 'bytes(SI)', id: 'decbytes', format: 'B', family: 'data-si', factor: 1 },
  { name: 'bits(IEC)', id: 'bits', format: 'b' },
  { name: 'bits(SI)', id: 'decbits', format: 'b' },
  { name: 'kibibytes', id: 'kbytes', format: 'KiB', family: 'data', factor: KiB },
  { name: 'kilobytes', id: 'deckbytes', format: 'KB', family: 'data-si', factor: 1e3 },
  { name: 'mebibytes', id: 'mbytes', format: 'MiB', family: 'data', factor: KiB ** 2 },
  { name: 'megabytes', id: 'decmbytes', format: 'MB', family: 'data-si', factor: 1e6 },
  { name: 'gibibytes', id: 'gbytes', format: 'GiB', family: 'data', factor: KiB ** 3 },
  { name: 'gigabytes', id: 'decgbytes', format: 'GB', family: 'data-si', factor: 1e9 },
  { name: 'packets/sec', id: 'pps', format: 'p/s' },
  { name: 'bytes/sec(IEC)', id: 'binBps', format: 'B/s' },
  { name: 'bytes/sec(SI)', id: 'Bps', format: 'B/s' },
  { name: 'bits/sec(IEC)', id: 'binbps', format: 'b/s' },
  { name: 'bits/sec(SI)', id: 'bps', format: 'b/s' },
  { name: 'Watt (W)', id: 'watt', format: 'W' },
  { name: 'Kilowatt (kW)', id: 'kwatt', format: 'kW' },
  { name: 'Joule (J)', id: 'joule', format: 'J' },
  { name: 'Ampere (A)', id: 'amp', format: 'A' },
  { name: 'Volt (V)', id: 'volt', format: 'V' },
  { name: 'Ohm (Ω)', id: 'ohm', format: 'Ω' },
  { name: 'Celsius (°C)', id: 'celsius', format: '°C' },
  { name: 'Fahrenheit (°F)', id: 'fahrenheit', format: '°F' },
  { name: 'Kelvin (K)', id: 'kelvin', format: 'K' },
  { name: 'Hertz (Hz)', id: 'hertz', format: 'Hz' },
  { name: 'nanoseconds (ns)', id: 'ns', format: 'ns', family: 'time', factor: 1e-9 },
  { name: 'microseconds (µs)', id: 'µs', format: 'µs', family: 'time', factor: 1e-6 },
  { name: 'milliseconds (ms)', id: 'ms', format: 'ms', family: 'time', factor: 1e-3 },
  { name: 'seconds (s)', id: 's', format: 's', family: 'time', factor: 1 },
  { name: 'minutes (m)', id: 'm', format: 'm', family: 'time', factor: 60 },
  { name: 'hours (h)', id: 'h', format: 'h', family: 'time', factor: 3600 },
  { name: 'days (d)', id: 'd', format: 'd', family: 'time', factor: 86400 },
  { name: 'duration (ms)', id: 'dtdurationms', format: 'ms', family: 'time', factor: 1e-3 },
  { name: 'duration (s)', id: 'dtdurations', format: 's', family: 'time', factor: 1 },
  { name: 'counts/sec (cps)', id: 'cps', format: 'c/s' },
  // The worker stores this verbatim on the errors/sec panels (109/220/304) and the stored
  // unit wins over the panel-id map, so without the entry `unitLabel` answers '' and the
  // comparison table shows those columns with no unit at all.
  { name: 'errors/sec (err/s)', id: 'err/s', format: 'err/s' },
  { name: 'ops/sec (ops)', id: 'ops', format: 'ops/s' },
  { name: 'requests/sec (rps)', id: 'reqps', format: 'req/s' },
  { name: 'reads/sec (rps)', id: 'rps', format: 'rd/s' },
  { name: 'writes/sec (wps)', id: 'wps', format: 'wr/s' },
  { name: 'I/O ops/sec (iops)', id: 'iops', format: 'io/s' },
  { name: 'meters/second (m/s)', id: 'velocityms', format: 'm/s' },
  { name: 'kilometers/hour (km/h)', id: 'velocitykmh', format: 'km/h' },
  { name: 'miles/hour (mph)', id: 'velocitymph', format: 'mph' },
];

/**
 * `panels-by-dashboard` answers a perf-test panel's unit as a display string ('ms', '%',
 * 'req/s', 'threads'). The SLO dialogs convert and store unit CODES, so map the two that
 * differ; the rest are already codes or are shown verbatim by `getUnit`'s fallback.
 */
export const perfPanelUnitCode = (unit?: string | null): string | undefined => {
  if (!unit) return undefined;
  return ({ '%': 'percent', 'req/s': 'reqps' } as Record<string, string>)[unit] ?? unit;
};

export const getUnit = (id?: string): Unit => {
  if (!id) {
    return { name: '', id: '', format: '' };
  }
  
  const unit = units.find((item) => item.id === id);
  return unit || { name: id, id: id, format: id };
};

/**
 * Format a numeric value with proper decimal places based on its magnitude
 * Removes trailing zeros for cleaner display
 */
const formatNumber = (value: number): string => {
  if (value === 0) {
    return '0';
  }

  // Very small numbers: show more precision
  if (Math.abs(value) < 0.01) {
    return parseFloat(value.toFixed(5)).toString();
  }

  // Round to 2 decimal places for comparison
  const roundedToTwoDecimals = Math.round(value * 100) / 100;

  // If rounded value is 0 but original wasn't, show more precision
  if (roundedToTwoDecimals === 0) {
    return parseFloat(value.toFixed(5)).toString();
  }
  // If it's a whole number, don't show decimals
  else if (Math.floor(roundedToTwoDecimals) === roundedToTwoDecimals) {
    return value.toFixed(0);
  }
  // Otherwise show 2 decimal places, removing trailing zeros
  else {
    return parseFloat(value.toFixed(2)).toString();
  }
};

/**
 * The family a unit code shares an axis with.
 *
 * An unknown or family-less code becomes its own family, keyed by the code itself, so
 * `reqps` and `ops` never silently share one axis and a Grafana code this table has
 * never heard of still gets an axis of its own rather than being lumped in with
 * whatever came first.
 */
export const unitFamily = (unitId?: string | null): string => {
  if (!unitId) return '';
  return units.find((u) => u.id === unitId)?.family ?? unitId;
};

/** Multiplier from a unit code to its family's base unit. 1 for a family of one. */
export const unitFactor = (unitId?: string | null): number =>
  (unitId ? units.find((u) => u.id === unitId)?.factor ?? 1 : 1);

/**
 * `percentunit` is stored 0.0-1.0 but always read as 0-100%. Every other unit is
 * already in the scale it is displayed in.
 */
export const toUnitScale = (value: number, unitId?: string): number =>
  (unitId === 'percentunit' ? value * 100 : value);

/**
 * The display label for a KNOWN Grafana unit code — 'ms', '%', 'req/s' — or '' when the
 * code is absent, unitless (`none`/`short`), or not in the table.
 *
 * Deliberately does NOT fall back to echoing the raw id the way `getUnit` does. The units
 * table covers ~50 of Grafana's ~200 codes, and a panel using `dateTimeAsIso` or
 * `currencyUSD` would otherwise label a column with the raw code, which reads as a real
 * unit in a customer-facing report rather than as a miss.
 */
export const unitLabel = (unitId?: string | null): string =>
  (unitId ? units.find((u) => u.id === unitId)?.format ?? '' : '');

export const formatValueWithUnit = (value: number | string | null | undefined, unitId?: string): string => {
  // Handle null, undefined, or empty values
  if (value === null || value === undefined || value === '') {
    return '-';
  }

  // Convert to number and validate
  const numValue = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(numValue)) {
    return '-';
  }

  const unit = getUnit(unitId);

  // Handle percentunit conversion: convert 0.0-1.0 to 0-100%
  if (unitId === 'percentunit') {
    const percentValue = numValue * 100;
    const formattedPercent = formatNumber(percentValue);
    return `${formattedPercent}${unit.format}`;
  }

  // Format the number based on its magnitude
  const formattedValue = formatNumber(numValue);

  // If no unit format, just return the formatted number
  if (!unit.format) {
    return formattedValue;
  }

  // For percent unit, don't add space before %
  if (unitId === 'percent') {
    return `${formattedValue}${unit.format}`;
  }

  return `${formattedValue} ${unit.format}`;
};
/**
 * The suffix ids `parseValueWithUnit` (SLO dialogs) recognises, as codes in this table.
 * A typed data size follows the panel's IEC/SI family: "500MB" on a `mbytes` panel means MiB.
 */
const TYPED_UNIT_CODES: Record<string, string | [iec: string, si: string]> = {
  ms: 'ms',
  s: 's',
  m: 'm',
  h: 'h',
  percent: 'percent',
  bytes: ['bytes', 'decbytes'],
  kb: ['kbytes', 'deckbytes'],
  mb: ['mbytes', 'decmbytes'],
  gb: ['gbytes', 'decgbytes'],
  req_per_s: 'reqps',
  ops_per_s: 'ops',
};

export type ThresholdConversion =
  | { value: number; from?: string; to?: string }
  | { error: string };

/** 0.1 * 3 style float noise would otherwise be stored and shown back as 0.30000000000000004. */
const roundFloat = (n: number): number => Number(n.toPrecision(12));

/**
 * Convert an SLO threshold typed as `value` + suffix into the number stored for a panel in
 * `panelUnit`, which is what the checks compare the panel's values against (#718).
 *
 * - No suffix: the number is already in the panel's display scale; `percentunit` stores 0-1.
 * - Same family (ms→s, MB→GB, %→percentunit): converted, with `from`/`to` set for the UI.
 * - Different family (% on a seconds panel): `error`, so the dialog can refuse to save.
 * - Unknown or unitless panel (`none`, `short`, a code not in the table), or no `panelUnit`
 *   (e.g. a trend SLO, which is %/h whatever the panel measures): nothing to convert
 *   against, so the number is taken as typed.
 */
export const convertThresholdToPanelUnit = (
  value: number,
  typedUnitId: string,
  panelUnit?: string | null,
): ThresholdConversion => {
  if (!typedUnitId) {
    return { value: panelUnit === 'percentunit' ? roundFloat(value / 100) : value };
  }
  const codes = TYPED_UNIT_CODES[typedUnitId];
  if (!panelUnit || !unitLabel(panelUnit) || !codes) return { value };

  const from = Array.isArray(codes) ? codes[unitFamily(panelUnit) === 'data-si' ? 1 : 0] : codes;
  if (unitFamily(from) !== unitFamily(panelUnit)) {
    return { error: `${getUnit(from).name} can't be compared with this metric's unit, ${getUnit(panelUnit).name}` };
  }
  return { value: roundFloat((value * unitFactor(from)) / unitFactor(panelUnit)), from, to: panelUnit };
};
