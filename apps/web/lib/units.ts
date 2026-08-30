/**
 * Unit mapping utility based on Grafana unit formats
 * Maps yAxesFormat values to human-readable units
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