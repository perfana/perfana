/**
 * Grafana unit-code formatting for report rendering.
 *
 * Ported from apps/web/lib/units.ts so generated reports show requirements
 * and values the same way the web UI does (e.g. "90%" instead of
 * "0.90 percentunit", "70" instead of "70.00 short"). Keep the two in sync.
 */

interface Unit {
  name: string;
  id: string;
  format: string;
}

const units: Unit[] = [
  { name: '', id: 'none', format: '' },
  { name: '', id: 'short', format: '' },
  { name: '%', id: 'percent', format: '%' },
  { name: 'Percent (0.0-1.0)', id: 'percentunit', format: '%' },
  { name: 'Humidity (%H)', id: 'humidity', format: '%H' },
  { name: 'Decibel', id: 'dB', format: 'dB' },
  { name: 'bytes(IEC)', id: 'bytes', format: 'B' },
  { name: 'bytes(SI)', id: 'decbytes', format: 'B' },
  { name: 'bits(IEC)', id: 'bits', format: 'b' },
  { name: 'bits(SI)', id: 'decbits', format: 'b' },
  { name: 'kibibytes', id: 'kbytes', format: 'KiB' },
  { name: 'kilobytes', id: 'deckbytes', format: 'KB' },
  { name: 'mebibytes', id: 'mbytes', format: 'MiB' },
  { name: 'megabytes', id: 'decmbytes', format: 'MB' },
  { name: 'gibibytes', id: 'gbytes', format: 'GiB' },
  { name: 'gigabytes', id: 'decgbytes', format: 'GB' },
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
  { name: 'nanoseconds (ns)', id: 'ns', format: 'ns' },
  { name: 'microseconds (µs)', id: 'µs', format: 'µs' },
  { name: 'milliseconds (ms)', id: 'ms', format: 'ms' },
  { name: 'seconds (s)', id: 's', format: 's' },
  { name: 'minutes (m)', id: 'm', format: 'm' },
  { name: 'hours (h)', id: 'h', format: 'h' },
  { name: 'days (d)', id: 'd', format: 'd' },
  { name: 'duration (ms)', id: 'dtdurationms', format: 'ms' },
  { name: 'duration (s)', id: 'dtdurations', format: 's' },
  { name: 'counts/sec (cps)', id: 'cps', format: 'c/s' },
  { name: 'ops/sec (ops)', id: 'ops', format: 'ops/s' },
  { name: 'requests/sec (rps)', id: 'reqps', format: 'req/s' },
  { name: 'reads/sec (rps)', id: 'rps', format: 'rd/s' },
  { name: 'writes/sec (wps)', id: 'wps', format: 'wr/s' },
  { name: 'I/O ops/sec (iops)', id: 'iops', format: 'io/s' },
  { name: 'meters/second (m/s)', id: 'velocityms', format: 'm/s' },
  { name: 'kilometers/hour (km/h)', id: 'velocitykmh', format: 'km/h' },
  { name: 'miles/hour (mph)', id: 'velocitymph', format: 'mph' },
];

const getUnit = (id?: string): Unit => {
  if (!id) {
    return { name: '', id: '', format: '' };
  }

  const unit = units.find((item) => item.id === id);
  return unit || { name: id, id: id, format: id };
};

/**
 * Format a numeric value with proper decimal places based on its magnitude.
 * Removes trailing zeros for cleaner display.
 */
const formatNumber = (value: number): string => {
  if (value === 0) {
    return '0';
  }

  if (Math.abs(value) < 0.01) {
    return parseFloat(value.toFixed(5)).toString();
  }

  const roundedToTwoDecimals = Math.round(value * 100) / 100;

  if (roundedToTwoDecimals === 0) {
    return parseFloat(value.toFixed(5)).toString();
  } else if (Math.floor(roundedToTwoDecimals) === roundedToTwoDecimals) {
    return value.toFixed(0);
  } else {
    return parseFloat(value.toFixed(2)).toString();
  }
};

/**
 * `percentunit` is stored 0.0-1.0 but always read as 0-100%. Every other unit is
 * already in the scale it is displayed in.
 */
export const toUnitScale = (value: number, unitId?: string): number =>
  (unitId === 'percentunit' ? value * 100 : value);

/**
 * Append a unit's suffix to an already-formatted number, so a caller keeps its own
 * number formatting (thousands grouping, em-dash for null) and only gains the unit.
 * `%` hugs the number; everything else is spaced.
 */
export const withUnitSuffix = (formatted: string, unitId?: string): string => {
  const { format } = getUnit(unitId);
  if (!format) return formatted;
  return unitId === 'percent' || unitId === 'percentunit' ? `${formatted}${format}` : `${formatted} ${format}`;
};

export const formatValueWithUnit = (
  value: number | string | null | undefined,
  unitId?: string,
): string => {
  if (value === null || value === undefined || value === '') {
    return '-';
  }

  const numValue = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(numValue)) {
    return '-';
  }

  const unit = getUnit(unitId);

  // percentunit is stored as 0.0-1.0 but displayed as 0-100%
  if (unitId === 'percentunit') {
    const percentValue = numValue * 100;
    const formattedPercent = formatNumber(percentValue);
    return `${formattedPercent}${unit.format}`;
  }

  const formattedValue = formatNumber(numValue);

  if (!unit.format) {
    return formattedValue;
  }

  if (unitId === 'percent') {
    return `${formattedValue}${unit.format}`;
  }

  return `${formattedValue} ${unit.format}`;
};
