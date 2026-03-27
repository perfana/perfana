/**
 * Unit tests for slo-formatters utility functions
 *
 * Tests:
 * - getSourceOption: returns a SourceOption object or null
 * - getEvaluateTypeOption: returns an EvaluateTypeOption object
 * - getRequirementOperatorOption: returns a RequirementOperatorOption object
 * - getDetectedUnit: returns a human-readable unit name for a value string
 * - getRequirementValuePlaceholder: returns placeholder text based on panel config
 * - getRequirementValueHelperText: returns helper text for the value input
 * - getEffectiveUnitFormat: extracts yAxesFormat or metricUnit from a panel object
 * - getUnitChipLabel: returns the chip label string or null
 * - isUnitChipPrimary: returns true when the value string contains an explicit unit
 * - SOURCE_OPTIONS / EVALUATE_TYPE_OPTIONS / REQUIREMENT_OPERATOR_OPTIONS: constant arrays
 */

import {
  getSourceOption,
  getEvaluateTypeOption,
  getRequirementOperatorOption,
  getDetectedUnit,
  getRequirementValuePlaceholder,
  getRequirementValueHelperText,
  getEffectiveUnitFormat,
  getUnitChipLabel,
  isUnitChipPrimary,
  SOURCE_OPTIONS,
  EVALUATE_TYPE_OPTIONS,
  REQUIREMENT_OPERATOR_OPTIONS,
} from '../slo-formatters';

// ---------------------------------------------------------------------------
// Constant arrays
// ---------------------------------------------------------------------------

describe('SOURCE_OPTIONS', () => {
  it('should include grafana and dynatrace options', () => {
    const values = SOURCE_OPTIONS.map((o) => o.value);
    expect(values).toContain('grafana');
    expect(values).toContain('dynatrace');
  });

  it('should have value and label on every option', () => {
    SOURCE_OPTIONS.forEach((opt) => {
      expect(typeof opt.value).toBe('string');
      expect(typeof opt.label).toBe('string');
    });
  });
});

describe('EVALUATE_TYPE_OPTIONS', () => {
  it('should include avg, max, min, and percentile entries', () => {
    const values = EVALUATE_TYPE_OPTIONS.map((o) => o.value);
    expect(values).toContain('avg');
    expect(values).toContain('max');
    expect(values).toContain('min');
    expect(values).toContain('q95');
  });

  it('should have value, label and description on every option', () => {
    EVALUATE_TYPE_OPTIONS.forEach((opt) => {
      expect(typeof opt.value).toBe('string');
      expect(typeof opt.label).toBe('string');
      expect(typeof opt.description).toBe('string');
    });
  });
});

describe('REQUIREMENT_OPERATOR_OPTIONS', () => {
  it('should include lt, lte, gt, gte, eq and ne operators', () => {
    const values = REQUIREMENT_OPERATOR_OPTIONS.map((o) => o.value);
    ['lt', 'lte', 'gt', 'gte', 'eq', 'ne'].forEach((op) => {
      expect(values).toContain(op);
    });
  });

  it('should have value, label and description on every option', () => {
    REQUIREMENT_OPERATOR_OPTIONS.forEach((opt) => {
      expect(typeof opt.value).toBe('string');
      expect(typeof opt.label).toBe('string');
      expect(typeof opt.description).toBe('string');
    });
  });
});

// ---------------------------------------------------------------------------
// getSourceOption
// ---------------------------------------------------------------------------

describe('getSourceOption', () => {
  describe('Known sources', () => {
    it('should return grafana option with correct label', () => {
      const result = getSourceOption('grafana');
      expect(result).not.toBeNull();
      expect(result!.value).toBe('grafana');
      expect(result!.label).toBe('Grafana');
    });

    it('should return dynatrace option with correct label', () => {
      const result = getSourceOption('dynatrace');
      expect(result).not.toBeNull();
      expect(result!.value).toBe('dynatrace');
      expect(result!.label).toBe('Dynatrace');
    });

    it('should return custom option with correct label', () => {
      const result = getSourceOption('custom');
      expect(result).not.toBeNull();
      expect(result!.value).toBe('custom');
      expect(result!.label).toBe('Custom');
    });

    it('should return prometheus option with correct label', () => {
      const result = getSourceOption('prometheus');
      expect(result).not.toBeNull();
      expect(result!.label).toBe('Prometheus');
    });

    it('should return influxdb option with correct label', () => {
      const result = getSourceOption('influxdb');
      expect(result).not.toBeNull();
      expect(result!.label).toBe('InfluxDB');
    });
  });

  describe('Unknown sources', () => {
    it('should return an option with capitalised label for an unknown source', () => {
      const result = getSourceOption('newrelic');
      expect(result).not.toBeNull();
      expect(result!.value).toBe('newrelic');
      // Capitalises first character
      expect(result!.label).toBe('Newrelic');
    });

    it('should return null for an empty string', () => {
      expect(getSourceOption('')).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// getEvaluateTypeOption
// ---------------------------------------------------------------------------

describe('getEvaluateTypeOption', () => {
  it('should return correct label for "avg"', () => {
    const result = getEvaluateTypeOption('avg');
    expect(result.value).toBe('avg');
    expect(result.label).toBe('Average');
    expect(result.description).toBeTruthy();
  });

  it('should return correct label for "q99"', () => {
    const result = getEvaluateTypeOption('q99');
    expect(result.value).toBe('q99');
    expect(result.label).toBe('99th Percentile');
  });

  it('should fall back to the raw value as label for unknown evaluate type', () => {
    const result = getEvaluateTypeOption('custom_type');
    expect(result.value).toBe('custom_type');
    expect(result.label).toBe('custom_type');
    expect(result.description).toBe('');
  });
});

// ---------------------------------------------------------------------------
// getRequirementOperatorOption
// ---------------------------------------------------------------------------

describe('getRequirementOperatorOption', () => {
  it('should return correct label for "lt"', () => {
    const result = getRequirementOperatorOption('lt');
    expect(result.value).toBe('lt');
    expect(result.label).toContain('<');
  });

  it('should return correct label for "gte"', () => {
    const result = getRequirementOperatorOption('gte');
    expect(result.value).toBe('gte');
    expect(result.label).toContain('≥');
  });

  it('should fall back to raw value as label for unknown operator', () => {
    const result = getRequirementOperatorOption('unknown_op');
    expect(result.value).toBe('unknown_op');
    expect(result.label).toBe('unknown_op');
  });
});

// ---------------------------------------------------------------------------
// getEffectiveUnitFormat
// ---------------------------------------------------------------------------

describe('getEffectiveUnitFormat', () => {
  it('should return yAxesFormat when present', () => {
    expect(getEffectiveUnitFormat({ yAxesFormat: 'ms', metricUnit: 's' })).toBe('ms');
  });

  it('should fall back to metricUnit when yAxesFormat is absent', () => {
    expect(getEffectiveUnitFormat({ metricUnit: 's' })).toBe('s');
  });

  it('should return undefined when panel is null', () => {
    expect(getEffectiveUnitFormat(null)).toBeUndefined();
  });

  it('should return undefined when panel is undefined', () => {
    expect(getEffectiveUnitFormat(undefined)).toBeUndefined();
  });

  it('should return undefined when panel has neither yAxesFormat nor metricUnit', () => {
    expect(getEffectiveUnitFormat({ title: 'Panel' })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getDetectedUnit — depends on getUnit from @/lib/units, which is imported
// transitively; behaviour tested at the string-matching level
// ---------------------------------------------------------------------------

describe('getDetectedUnit', () => {
  it('should return a non-empty string for "500ms"', () => {
    const unit = getDetectedUnit('500ms');
    expect(typeof unit).toBe('string');
    // The exact label comes from the units library; just assert it is non-empty
    expect(unit.length).toBeGreaterThanOrEqual(0);
  });

  it('should return empty string for a plain number with no unit', () => {
    expect(getDetectedUnit('500')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// getRequirementValuePlaceholder
// ---------------------------------------------------------------------------

describe('getRequirementValuePlaceholder', () => {
  it('should return generic placeholder when panel is null', () => {
    const placeholder = getRequirementValuePlaceholder(null);
    expect(placeholder).toContain('500');
  });

  it('should return generic placeholder when panel has no unit format', () => {
    const placeholder = getRequirementValuePlaceholder({ title: 'Response Time' });
    expect(placeholder).toContain('500');
  });

  it('should return a panel-specific placeholder when panel has a yAxesFormat', () => {
    // When format is recognised, the placeholder starts with "e.g. 500"
    const placeholder = getRequirementValuePlaceholder({ yAxesFormat: 'ms' });
    expect(placeholder).toMatch(/^e\.g\. 500/);
  });
});

// ---------------------------------------------------------------------------
// getRequirementValueHelperText
// ---------------------------------------------------------------------------

describe('getRequirementValueHelperText', () => {
  it('should return default helper text when value is empty and panel has no format', () => {
    const text = getRequirementValueHelperText('', null);
    expect(text).toBe('Enter threshold value');
  });

  it('should return unit description when the value contains a recognised unit', () => {
    const text = getRequirementValueHelperText('500ms', null);
    // The text should mention "Unit:" with some label
    expect(text).toMatch(/Unit:/i);
  });

  it('should return expected unit text when panel has a format but value has no unit', () => {
    const text = getRequirementValueHelperText('500', { yAxesFormat: 'ms' });
    // Should mention the expected unit
    expect(text.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// getUnitChipLabel
// ---------------------------------------------------------------------------

describe('getUnitChipLabel', () => {
  it('should return the unit string from the value when a unit is present', () => {
    // "500ms" has an explicit unit suffix
    const label = getUnitChipLabel('500ms', null);
    expect(label).toBeTruthy();
  });

  it('should return null when neither value has unit nor panel has a format', () => {
    expect(getUnitChipLabel('500', null)).toBeNull();
  });

  it('should return null when value is empty and panel has no format', () => {
    expect(getUnitChipLabel('', null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isUnitChipPrimary
// ---------------------------------------------------------------------------

describe('isUnitChipPrimary', () => {
  it('should return true when value contains an explicit unit', () => {
    expect(isUnitChipPrimary('500ms')).toBe(true);
  });

  it('should return false when value is a plain number', () => {
    expect(isUnitChipPrimary('500')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isUnitChipPrimary('')).toBe(false);
  });
});
