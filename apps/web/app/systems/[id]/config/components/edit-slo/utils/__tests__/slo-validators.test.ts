/**
 * Unit tests for slo-validators utility functions
 *
 * Tests:
 * - validateSLOForm: validation of the SLO form data
 * - isFormValid: boolean validity check for form submission
 * - toStoredThresholdValue: converts display percentage to stored decimal
 * - convertDecimalToPercentageForDisplay: converts stored decimal to display percentage
 * - parseValueWithUnit: parses numeric values with optional unit strings
 * - SUPPORTED_PANEL_TYPES: constant export
 */

import {
  validateSLOForm,
  isFormValid,
  toStoredThresholdValue,
  convertDecimalToPercentageForDisplay,
  storedThresholdUnit,
  parseValueWithUnit,
  SUPPORTED_PANEL_TYPES,
} from '../slo-validators';
import { SLOFormData } from '../../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFormData(overrides: Partial<SLOFormData> = {}): SLOFormData {
  return {
    source: 'grafana',
    selectedDashboard: { id: 'dash-1', dashboard_uid: 'uid-123' },
    selectedPanel: { id: 42, title: 'Response Time' },
    evaluateType: 'avg',
    requirementOperator: 'lt',
    requirementValue: '500',
    tags: [],
    excludeRampUpTime: true,
    averageAll: false,
    matchPattern: '',
    // apps/web/tsconfig.json excludes **/*.test.ts, so nothing type-checks this
    // literal against SLOFormData — it had already drifted (invertMatchPattern was
    // missing) before `enabled` was added. Keep it complete by hand.
    invertMatchPattern: false,
    validateWithDefaultIfNoData: false,
    validateWithDefaultIfNoDataValue: '',
    enabled: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// SUPPORTED_PANEL_TYPES
// ---------------------------------------------------------------------------

describe('SUPPORTED_PANEL_TYPES', () => {
  it('should export an array containing core Grafana panel types', () => {
    expect(Array.isArray(SUPPORTED_PANEL_TYPES)).toBe(true);
    expect(SUPPORTED_PANEL_TYPES).toContain('timeseries');
    expect(SUPPORTED_PANEL_TYPES).toContain('graph');
    expect(SUPPORTED_PANEL_TYPES).toContain('stat');
  });
});

// ---------------------------------------------------------------------------
// parseValueWithUnit
// ---------------------------------------------------------------------------

describe('parseValueWithUnit', () => {
  describe('Happy Path Scenarios', () => {
    it('should parse a plain numeric string with no unit', () => {
      const result = parseValueWithUnit('500');
      expect(result.value).toBe('500');
      expect(result.unit).toBe('');
      expect(result.unitId).toBe('');
    });

    it('should parse milliseconds (ms)', () => {
      const result = parseValueWithUnit('200ms');
      expect(result.value).toBe('200');
      expect(result.unit).toBe('ms');
      expect(result.unitId).toBe('ms');
    });

    it('should parse seconds (s)', () => {
      const result = parseValueWithUnit('5s');
      expect(result.value).toBe('5');
      expect(result.unitId).toBe('s');
    });

    it('should parse percentage (%)', () => {
      const result = parseValueWithUnit('95%');
      expect(result.value).toBe('95');
      expect(result.unitId).toBe('percent');
    });

    it('should parse gigabytes (GB)', () => {
      const result = parseValueWithUnit('2GB');
      expect(result.value).toBe('2');
      expect(result.unitId).toBe('gb');
    });

    it('should parse requests per second (req/s)', () => {
      const result = parseValueWithUnit('50req/s');
      expect(result.value).toBe('50');
      expect(result.unitId).toBe('req_per_s');
    });

    it('should parse megabytes (MB)', () => {
      const result = parseValueWithUnit('256MB');
      expect(result.value).toBe('256');
      expect(result.unitId).toBe('mb');
    });

    it('should parse kilobytes (KB)', () => {
      const result = parseValueWithUnit('1024KB');
      expect(result.value).toBe('1024');
      expect(result.unitId).toBe('kb');
    });

    it('should parse decimal values', () => {
      const result = parseValueWithUnit('1.5s');
      expect(result.value).toBe('1.5');
      expect(result.unitId).toBe('s');
    });

    it('should be case-insensitive for unit matching', () => {
      const upper = parseValueWithUnit('500MS');
      const lower = parseValueWithUnit('500ms');
      expect(upper.unitId).toBe(lower.unitId);
    });

    it('should handle values with spaces between number and unit', () => {
      const result = parseValueWithUnit('200 ms');
      expect(result.value).toBe('200');
      expect(result.unitId).toBe('ms');
    });
  });

  describe('Edge Cases', () => {
    it('should return empty unit fields for unrecognised input', () => {
      const result = parseValueWithUnit('some-string');
      expect(result.value).toBe('some-string');
      expect(result.unit).toBe('');
      expect(result.unitId).toBe('');
    });

    it('should return empty unit fields for empty string', () => {
      const result = parseValueWithUnit('');
      expect(result.value).toBe('');
      expect(result.unit).toBe('');
    });
  });
});

// ---------------------------------------------------------------------------
// convertDecimalToPercentageForDisplay
// ---------------------------------------------------------------------------

describe('convertDecimalToPercentageForDisplay', () => {
  describe('Happy Path Scenarios — percentunit format', () => {
    it('should convert 0.95 to "95" when format is percentunit', () => {
      expect(convertDecimalToPercentageForDisplay(0.95, 'percentunit')).toBe('95');
    });

    it('should convert 0.5 to "50" when format is percentunit', () => {
      expect(convertDecimalToPercentageForDisplay(0.5, 'percentunit')).toBe('50');
    });

    it('should convert 0.001 to "0.1" when format is percentunit', () => {
      expect(convertDecimalToPercentageForDisplay(0.001, 'percentunit')).toBe('0.1');
    });

    // #719: a value >= 1 used to be shown as-is, so 1 (100%) displayed as "1" and saved as 0.01.
    it('scales a value >= 1 too: 1 is 100%', () => {
      expect(convertDecimalToPercentageForDisplay(1, 'percentunit')).toBe('100');
      expect(convertDecimalToPercentageForDisplay(1.5, 'percentunit')).toBe('150');
    });

    it('drops float noise', () => {
      expect(convertDecimalToPercentageForDisplay(0.009, 'percentunit')).toBe('0.9');
      expect(convertDecimalToPercentageForDisplay(0.07, 'percentunit')).toBe('7');
    });
  });

  describe('Non-percentunit formats', () => {
    it('should return the raw string when format is ms', () => {
      expect(convertDecimalToPercentageForDisplay(500, 'ms')).toBe('500');
    });

    it('should return the raw string when format is undefined', () => {
      expect(convertDecimalToPercentageForDisplay(0.95, undefined)).toBe('0.95');
    });

    it('should return empty string when value is undefined', () => {
      expect(convertDecimalToPercentageForDisplay(undefined, 'percentunit')).toBe('');
    });

    it('should return empty string when value is undefined and format is also undefined', () => {
      expect(convertDecimalToPercentageForDisplay(undefined, undefined)).toBe('');
    });
  });
});

// ---------------------------------------------------------------------------
// toStoredThresholdValue
// ---------------------------------------------------------------------------

describe('toStoredThresholdValue', () => {
  describe('Happy Path Scenarios — percentunit format', () => {
    it('should convert "95" to "0.95" for percentunit format', () => {
      expect(toStoredThresholdValue('95', 'percentunit')).toBe('0.95');
    });

    it('should convert "50" to "0.5" for percentunit format', () => {
      expect(toStoredThresholdValue('50', 'percentunit')).toBe('0.5');
    });

    it('should convert "100" to "1" for percentunit format', () => {
      expect(toStoredThresholdValue('100', 'percentunit')).toBe('1');
    });
  });

  describe('Non-percentunit formats', () => {
    it('should return the original value unchanged for ms format', () => {
      expect(toStoredThresholdValue('500', 'ms')).toBe('500');
    });

    it('should return the original value unchanged when format is undefined', () => {
      expect(toStoredThresholdValue('500', undefined)).toBe('500');
    });

    it('should return the original value unchanged when format is empty string', () => {
      expect(toStoredThresholdValue('500', '')).toBe('500');
    });
  });

  // #717: the suffix used to reach the API, where Number('0.5s') stored NaN.
  // #718: and it is converted to the panel's unit.
  describe('Unit suffix is stripped and converted', () => {
    it.each([
      ['0.5s', 's', '0.5'],
      ['500ms', 's', '0.5'],
      ['2m', 'ms', '120000'],
      ['500 ms', undefined, '500'],
      [' 0.5 ', 's', '0.5'],
      ['90%', 'percentunit', '0.9'],
      ['95 percent', 'percentunit', '0.95'],
    ])('%s on a %s panel -> %s', (input, format, expected) => {
      expect(toStoredThresholdValue(input, format)).toBe(expected);
    });

    it('leaves a non-numeric value for validation to reject', () => {
      expect(toStoredThresholdValue('abc', 's')).toBe('abc');
    });
    it('leaves an unconvertible unit for validation to reject', () => {
      expect(toStoredThresholdValue('90%', 's')).toBe('90%');
    });
  });
});

// ---------------------------------------------------------------------------
// validateSLOForm
// ---------------------------------------------------------------------------

describe('validateSLOForm', () => {
  describe('Happy Path Scenarios', () => {
    it('should return empty errors when form data is fully valid', () => {
      const errors = validateSLOForm(makeFormData());
      expect(errors).toEqual({});
    });

    it('should return empty errors when requirementValue contains a unit string', () => {
      const errors = validateSLOForm(makeFormData({ requirementValue: '500ms' }));
      expect(errors).toEqual({});
    });

    it('should return empty errors for valid validateWithDefaultIfNoData configuration', () => {
      const errors = validateSLOForm(
        makeFormData({
          validateWithDefaultIfNoData: true,
          validateWithDefaultIfNoDataValue: '1000',
        })
      );
      expect(errors).toEqual({});
    });
  });

  describe('selectedDashboard validation', () => {
    it('should error when selectedDashboard is null', () => {
      const errors = validateSLOForm(makeFormData({ selectedDashboard: null }));
      expect(errors.selectedDashboard).toBeTruthy();
    });

    it('should error when selectedDashboard is undefined', () => {
      const errors = validateSLOForm(makeFormData({ selectedDashboard: undefined }));
      expect(errors.selectedDashboard).toBeTruthy();
    });

    it('should not error when selectedDashboard is a valid object', () => {
      const errors = validateSLOForm(makeFormData({ selectedDashboard: { id: 'x' } }));
      expect(errors.selectedDashboard).toBeUndefined();
    });
  });

  describe('selectedPanel validation', () => {
    it('should error when selectedPanel is null', () => {
      const errors = validateSLOForm(makeFormData({ selectedPanel: null }));
      expect(errors.selectedPanel).toBeTruthy();
    });

    it('should not error when selectedPanel is a valid object', () => {
      const errors = validateSLOForm(makeFormData({ selectedPanel: { id: 1, title: 'Panel' } }));
      expect(errors.selectedPanel).toBeUndefined();
    });
  });

  describe('requirementValue validation', () => {
    it('should error when requirementValue is empty string', () => {
      const errors = validateSLOForm(makeFormData({ requirementValue: '' }));
      expect(errors.requirementValue).toBeTruthy();
    });

    it('should error when requirementValue is whitespace only', () => {
      const errors = validateSLOForm(makeFormData({ requirementValue: '   ' }));
      expect(errors.requirementValue).toBeTruthy();
    });

    it('should error when requirementValue is non-numeric text without a unit', () => {
      const errors = validateSLOForm(makeFormData({ requirementValue: 'abc' }));
      expect(errors.requirementValue).toBeTruthy();
    });

    it('should not error for "0" as requirementValue', () => {
      const errors = validateSLOForm(makeFormData({ requirementValue: '0' }));
      expect(errors.requirementValue).toBeUndefined();
    });
  });

  describe('validateWithDefaultIfNoData validation', () => {
    it('should error when validateWithDefaultIfNoData is true but value is empty', () => {
      const errors = validateSLOForm(
        makeFormData({
          validateWithDefaultIfNoData: true,
          validateWithDefaultIfNoDataValue: '',
        })
      );
      expect(errors.validateWithDefaultIfNoDataValue).toBeTruthy();
    });

    it('should error when default value is whitespace only', () => {
      const errors = validateSLOForm(
        makeFormData({
          validateWithDefaultIfNoData: true,
          validateWithDefaultIfNoDataValue: '   ',
        })
      );
      expect(errors.validateWithDefaultIfNoDataValue).toBeTruthy();
    });

    it('should error when default value is non-numeric text', () => {
      const errors = validateSLOForm(
        makeFormData({
          validateWithDefaultIfNoData: true,
          validateWithDefaultIfNoDataValue: 'bad',
        })
      );
      expect(errors.validateWithDefaultIfNoDataValue).toBeTruthy();
    });

    it('should not error when validateWithDefaultIfNoData is false even if value is empty', () => {
      const errors = validateSLOForm(
        makeFormData({
          validateWithDefaultIfNoData: false,
          validateWithDefaultIfNoDataValue: '',
        })
      );
      expect(errors.validateWithDefaultIfNoDataValue).toBeUndefined();
    });
  });

  describe('Multiple errors at once', () => {
    it('should return errors for all invalid fields simultaneously', () => {
      const errors = validateSLOForm(
        makeFormData({
          selectedDashboard: null,
          selectedPanel: null,
          requirementValue: '',
        })
      );
      expect(errors.selectedDashboard).toBeTruthy();
      expect(errors.selectedPanel).toBeTruthy();
      expect(errors.requirementValue).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// isFormValid
// ---------------------------------------------------------------------------

describe('isFormValid', () => {
  const systemId = 'sys-1';
  const environment = 'production';
  const workload = 'normal';

  describe('Happy Path Scenarios', () => {
    it('should return true when all required fields are provided', () => {
      expect(isFormValid(systemId, environment, workload, makeFormData())).toBe(true);
    });

    it('should return true when validateWithDefaultIfNoData is false regardless of default value', () => {
      expect(
        isFormValid(
          systemId,
          environment,
          workload,
          makeFormData({ validateWithDefaultIfNoData: false, validateWithDefaultIfNoDataValue: '' })
        )
      ).toBe(true);
    });

    it('should return true when validateWithDefaultIfNoData is true and value is supplied', () => {
      expect(
        isFormValid(
          systemId,
          environment,
          workload,
          makeFormData({
            validateWithDefaultIfNoData: true,
            validateWithDefaultIfNoDataValue: '1000',
          })
        )
      ).toBe(true);
    });
  });

  describe('Missing context parameters', () => {
    it('should return false when systemId is empty', () => {
      expect(isFormValid('', environment, workload, makeFormData())).toBe(false);
    });

    it('should return false when environment is empty', () => {
      expect(isFormValid(systemId, '', workload, makeFormData())).toBe(false);
    });

    it('should return false when workload is empty', () => {
      expect(isFormValid(systemId, environment, '', makeFormData())).toBe(false);
    });
  });

  describe('Missing form fields', () => {
    it('should return false when selectedDashboard is null — the critical Save-button bug scenario', () => {
      expect(
        isFormValid(systemId, environment, workload, makeFormData({ selectedDashboard: null }))
      ).toBe(false);
    });

    it('should return false when selectedPanel is null', () => {
      expect(
        isFormValid(systemId, environment, workload, makeFormData({ selectedPanel: null }))
      ).toBe(false);
    });

    it('should return false when requirementValue is empty string', () => {
      expect(
        isFormValid(systemId, environment, workload, makeFormData({ requirementValue: '' }))
      ).toBe(false);
    });

    it('should return false when requirementValue is whitespace only', () => {
      expect(
        isFormValid(systemId, environment, workload, makeFormData({ requirementValue: '   ' }))
      ).toBe(false);
    });

    it('should return false when validateWithDefaultIfNoData is true but default value is empty', () => {
      expect(
        isFormValid(
          systemId,
          environment,
          workload,
          makeFormData({
            validateWithDefaultIfNoData: true,
            validateWithDefaultIfNoDataValue: '',
          })
        )
      ).toBe(false);
    });

    it('should return false when validateWithDefaultIfNoData is true and default value is whitespace', () => {
      expect(
        isFormValid(
          systemId,
          environment,
          workload,
          makeFormData({
            validateWithDefaultIfNoData: true,
            validateWithDefaultIfNoDataValue: '   ',
          })
        )
      ).toBe(false);
    });
  });

  describe('Synthetic object truthy check — the root-cause scenario', () => {
    it('should return true when selectedDashboard is a synthetic Grafana object built from benchmark data', () => {
      const syntheticDashboard = {
        id: 'app-dash-id',
        dashboard_uid: 'abc123',
        dashboard_label: 'My Dashboard',
        dashboard_id: 7,
        grafanaInstance: { label: 'prod-grafana' },
      };
      const syntheticPanel = {
        id: 5,
        title: 'Response Time',
        type: 'timeseries',
        yAxesFormat: 'ms',
        metricUnit: undefined,
      };

      expect(
        isFormValid(
          systemId,
          environment,
          workload,
          makeFormData({ selectedDashboard: syntheticDashboard, selectedPanel: syntheticPanel })
        )
      ).toBe(true);
    });

    it('should return true when selectedDashboard is a synthetic Dynatrace object', () => {
      const syntheticDashboard = { dashboardLabel: 'Dynatrace Dashboard' };
      const syntheticPanel = { panelTitle: 'Error Rate' };

      expect(
        isFormValid(
          systemId,
          environment,
          workload,
          makeFormData({ selectedDashboard: syntheticDashboard, selectedPanel: syntheticPanel })
        )
      ).toBe(true);
    });

    it('should return true when selectedDashboard is the minimal synthetic object with just dashboardLabel', () => {
      // The minimal synthetic object should be truthy
      const minimalDashboard = { dashboardLabel: 'Dashboard' };
      expect(
        isFormValid(
          systemId,
          environment,
          workload,
          makeFormData({ selectedDashboard: minimalDashboard })
        )
      ).toBe(true);
    });
  });
});

describe('validateSLOForm unit check (#718)', () => {
  it('refuses a unit that cannot be converted to the panel unit', () => {
    const errors = validateSLOForm(
      makeFormData({ requirementValue: '90%', selectedPanel: { id: 1, title: 'Latency', yAxesFormat: 's' } })
    );
    expect(errors.requirementValue).toMatch(/can't be compared/);
  });

  it('accepts a convertible unit', () => {
    const errors = validateSLOForm(
      makeFormData({ requirementValue: '500ms', selectedPanel: { id: 1, title: 'Latency', yAxesFormat: 's' } })
    );
    expect(errors.requirementValue).toBeUndefined();
  });

  it('does not check units for a trend, which is %/h whatever the panel measures', () => {
    const errors = validateSLOForm(
      makeFormData({ requirementValue: '5%', evaluateType: 'trend', selectedPanel: { id: 1, title: 'Latency', yAxesFormat: 's' } })
    );
    expect(errors.requirementValue).toBeUndefined();
  });

  it('checks the default value too', () => {
    const errors = validateSLOForm(
      makeFormData({
        selectedPanel: { id: 1, title: 'Latency', yAxesFormat: 's' },
        validateWithDefaultIfNoData: true,
        validateWithDefaultIfNoDataValue: '1GB',
      })
    );
    expect(errors.validateWithDefaultIfNoDataValue).toMatch(/can't be compared/);
  });
});

describe('storedThresholdUnit (#719)', () => {
  it.each([
    [{ configuration: { yAxesFormat: 'percentunit' } }, 'percentunit'],
    [{ configuration: { metricUnit: 'percentunit' } }, 'percentunit'],
    [{ metric_unit: 'percentunit', configuration: {} }, 'percentunit'],
    [{ metric_unit: 'percentunit', configuration: null }, 'percentunit'],
    [{ configuration: { yAxesFormat: 's' }, metric_unit: 'percentunit' }, 's'],
    [{ evaluate_type: 'trend', metric_unit: '%/h', configuration: { yAxesFormat: 'percentunit' } }, undefined],
    [{}, undefined],
  ])('%j -> %p', (benchmark, expected) => {
    expect(storedThresholdUnit(benchmark)).toBe(expected);
  });

  it.each([0.9, 0.95, 1, 0.07, 0.001, 1.5])('display -> save round-trips %p on a percentunit SLO', (stored) => {
    const unit = storedThresholdUnit({ metric_unit: 'percentunit' });
    expect(Number(toStoredThresholdValue(convertDecimalToPercentageForDisplay(stored, unit), unit))).toBe(stored);
  });
});

// #721: Number() accepts hex, exponents and Infinity; a threshold is a plain decimal.
describe('validateSLOForm accepts plain decimals only', () => {
  it.each(['0x10', '1e3', 'Infinity', '1,5', '5 5'])('refuses %p', (requirementValue) => {
    expect(validateSLOForm(makeFormData({ requirementValue })).requirementValue).toBe('Requirement value must be a valid number');
  });

  it.each(['5', '0.5', '.5', '-5', '500ms', '90%'])('accepts %p', (requirementValue) => {
    expect(validateSLOForm(makeFormData({ requirementValue })).requirementValue).toBeUndefined();
  });
});
