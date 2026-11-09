/** #721: the delete confirm reuses the table's labels so two SLOs on one panel can be told apart. */
import { sloEvaluationLabel, sloRequirementLabel } from '../SLOTable';
import type { Benchmark } from '../types';

const slo = (b: Partial<Benchmark>) => b as Benchmark;

it('labels the evaluation type', () => {
  expect(sloEvaluationLabel(slo({ evaluate_type: 'max' }))).toBe('Maximum');
  expect(sloEvaluationLabel(slo({ evaluate_type: 'q95' }))).toBe('95th Percentile');
});

it('labels the requirement with its unit, percentunit as a percentage', () => {
  expect(sloRequirementLabel(slo({ requirement_operator: 'lt', requirement_value: 0.9, metric_unit: 'percentunit' }))).toBe('Less than 90 %');
  expect(sloRequirementLabel(slo({ requirement_operator: 'gte', requirement_value: 0.5, metric_unit: 's' }))).toBe('Greater than or equal 0.5 s');
});
