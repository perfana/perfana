import { describe, it, expect } from 'vitest';
import { evaluateRequirement } from '../../../../pipelines/checks/requirement-operator.js';

/**
 * The SLO dialog offers six operators; the worker used to implement two. The case that
 * surfaced it: an SLO "≠ 26.25" on WERKNL-00001's Transaction Error Rate reported
 * WG_VAC_16_Stuur_Email (26.25) as meeting the requirement.
 */
describe('evaluateRequirement', () => {
  it('implements every operator the SLO dialog offers, by code and by symbol', () => {
    expect(evaluateRequirement(26.25, 'ne', 26.25)).toBe(false);
    expect(evaluateRequirement(0, 'ne', 26.25)).toBe(true);
    expect(evaluateRequirement(26.25, 'eq', 26.25)).toBe(true);
    expect(evaluateRequirement(5, 'lte', 5)).toBe(true);
    expect(evaluateRequirement(5, 'lt', 5)).toBe(false);
    expect(evaluateRequirement(5, 'gte', 5)).toBe(true);
    expect(evaluateRequirement(5, 'gt', 5)).toBe(false);
    expect(evaluateRequirement(6, '>', 5)).toBe(true);
    expect(evaluateRequirement(5, '<=', 5)).toBe(true);
    expect(evaluateRequirement(5, ' GE ', 5)).toBe(true);
  });

  it('leaves an operator nobody defined to the caller', () => {
    expect(evaluateRequirement(1, 'between', 2)).toBeNull();
  });
});
