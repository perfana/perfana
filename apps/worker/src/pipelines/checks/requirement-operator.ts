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
export function evaluateRequirement(value: number | string, operator: string, threshold: number | string): boolean | null {
  // `benchmarks.requirement_value` is NUMERIC, which node-postgres hands over as a STRING
  // and nothing in the worker registers a parser for. `<` coerces; `===` does not, so
  // without this an "= 26.25" SLO could never pass and a "≠ 26.25" one could never fail.
  const v = Number(value);
  const t = Number(threshold);
  if (!Number.isFinite(v) || !Number.isFinite(t)) {
    return null;
  }
  switch (operator.trim().toLowerCase()) {
    case 'lt': case '<': return v < t;
    case 'lte': case 'le': case '<=': return v <= t;
    case 'gt': case '>': return v > t;
    case 'gte': case 'ge': case '>=': return v >= t;
    case 'eq': case '=': case '==': return v === t;
    case 'ne': case '!=': case '<>': return v !== t;
    default: return null;
  }
}
