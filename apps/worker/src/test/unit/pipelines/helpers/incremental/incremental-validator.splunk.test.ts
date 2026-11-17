import { describe, it, expect } from 'vitest';
import { IncrementalValidator } from '../../../../../pipelines/helpers/incremental/incremental-validator.js';

describe('IncrementalValidator', () => {
  it('passes the Splunk fields through (it rebuilds the input field by field)', () => {
    const result = new IncrementalValidator().validateInput({
      testRunId: 'run-1',
      fromTime: '2026-11-17T10:00:00Z',
      toTime: '2026-11-17T10:01:00Z',
      collectSplunkMetrics: true,
      splunkConfigId: 'cfg-1',
    });
    expect(result.valid).toBe(true);
    expect(result.input).toMatchObject({ collectSplunkMetrics: true, splunkConfigId: 'cfg-1' });
  });
});
