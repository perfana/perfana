/**
 * One evaluator for every requirement operator an SLO can carry.
 *
 * The SLO dialog offers six codes (`lt lte gt gte eq ne`), profile benchmarks
 * accept the same six, and older rows / the aggregated evaluator's callers use
 * the symbols (`< <= > >= = !=`). Until v0.2.95.31 `RequirementChecker` knew
 * only `lt`/`gt` and answered every other operator with a warning and `true`,
 * so an SLO "≠ 26.25" on a target measuring 26.25 was reported as met.
 *
 * Returns null for an operator nobody defined, so the caller decides what an
 * unknown operator means rather than inheriting a silent pass.
 */
export function evaluateRequirement(value: number, operator: string, threshold: number): boolean | null {
  switch (operator.trim().toLowerCase()) {
    case 'lt': case '<': return value < threshold;
    case 'lte': case 'le': case '<=': return value <= threshold;
    case 'gt': case '>': return value > threshold;
    case 'gte': case 'ge': case '>=': return value >= threshold;
    case 'eq': case '=': case '==': return value === threshold;
    case 'ne': case '!=': case '<>': return value !== threshold;
    default: return null;
  }
}
