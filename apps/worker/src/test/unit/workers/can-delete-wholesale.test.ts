import { describe, it, expect } from 'vitest';
import { canDeleteWholesale } from '../../../workers/simple-orchestrate-reevaluate-batch.js';

/**
 * #563. `test_run_id` is ds_metrics' `compress_segmentby` column, so a DELETE filtered on
 * it alone is segment-targeted and needs no decompression. Measured on one 2,453,285-row
 * run sitting in a compressed chunk:
 *
 *   WHERE test_run_id = $1                        181 ms       41 MB WAL
 *   WHERE test_run_id = $1 AND source IN (...)  54,233 ms    4,023 MB WAL + ERROR
 *
 * This predicate decides which of the two the force-refetch takes. Getting it wrong in the
 * permissive direction deletes metrics that nothing is going to put back, so it fails closed.
 */
describe('canDeleteWholesale', () => {
  it('allows the segment-targeted delete when every present type is being re-collected', () => {
    expect(canDeleteWholesale(['performance_test', 'grafana'], ['grafana', 'performance_test'])).toBe(true);
  });

  it('allows it when more is being re-collected than is present', () => {
    // A source with a collection status but no rows yet is not a reason to refuse.
    expect(canDeleteWholesale(['performance_test'], ['performance_test', 'grafana', 'dynatrace'])).toBe(true);
  });

  it('refuses when a present type is NOT being re-collected', () => {
    // The user unchecked Grafana: its rows must survive the delete.
    expect(canDeleteWholesale(['performance_test', 'grafana'], ['performance_test'])).toBe(false);
  });

  it("refuses when rows have no metrics source ('unknown')", () => {
    // A NULL metrics_source_id belongs to no source, so nothing re-collects it. The old
    // filtered delete carried `metrics_source_id IS NOT NULL` and never touched these;
    // the wholesale delete would, which is precisely why they force the fallback.
    expect(canDeleteWholesale(['performance_test', 'unknown'], ['performance_test', 'grafana', 'dynatrace'])).toBe(false);
  });

  it('refuses when the run has no ds_metrics rows at all', () => {
    // Nothing to delete; taking the "safe" branch here would only mean a pointless DELETE.
    expect(canDeleteWholesale([], ['performance_test', 'grafana'])).toBe(false);
  });

  it('refuses when nothing is being re-collected', () => {
    expect(canDeleteWholesale(['performance_test'], [])).toBe(false);
  });

  it('is not fooled by duplicate entries in either list', () => {
    expect(canDeleteWholesale(['grafana', 'grafana'], ['grafana'])).toBe(true);
    expect(canDeleteWholesale(['grafana', 'dynatrace'], ['grafana', 'grafana'])).toBe(false);
  });
});
