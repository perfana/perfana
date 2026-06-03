/**
 * Unit tests for scenario dashboard UID generation.
 *
 * Regression coverage for issue #388: a long JMeter scenario/thread-group name
 * must not produce a UID longer than the `application_dashboards.dashboard_uid`
 * `varchar(100)` column, which previously aborted the whole
 * PerformanceTestMetricsPipeline on the first offending scenario.
 */

import { describe, it, expect } from 'vitest';
import {
  generateScenarioDashboardUid,
  generateScenarioDashboardUuid,
} from '../../../utils/uuid-generator.js';

const MAX_UID_LENGTH = 100;
const PREFIX = 'performance-test-metrics-';

describe('generateScenarioDashboardUid', () => {
  it('returns the unchanged prefixed UID for short scenario names', () => {
    expect(generateScenarioDashboardUid('loadtest')).toBe(
      'performance-test-metrics-loadtest'
    );
  });

  it('sanitizes non-alphanumeric characters to hyphens', () => {
    expect(generateScenarioDashboardUid('Load Test 1')).toBe(
      'performance-test-metrics-load-test-1'
    );
  });

  it('never exceeds the varchar(100) limit for very long names', () => {
    const longName =
      '10.178.135.133:1099-Thread Group - Voor tijdens de ontwikkeling van het script';
    const uid = generateScenarioDashboardUid(longName);
    expect(uid.length).toBeLessThanOrEqual(MAX_UID_LENGTH);
    expect(uid.startsWith(PREFIX)).toBe(true);
  });

  it('caps even pathologically long names at 100 chars', () => {
    const uid = generateScenarioDashboardUid('x'.repeat(500));
    expect(uid.length).toBeLessThanOrEqual(MAX_UID_LENGTH);
  });

  it('is deterministic — same input yields same UID across runs', () => {
    const name = 'a-really-long-scenario-name-that-definitely-overflows-the-one-hundred-character-column-limit';
    expect(generateScenarioDashboardUid(name)).toBe(generateScenarioDashboardUid(name));
  });

  it('maps two long names sharing a truncated prefix to distinct UIDs', () => {
    const base = 'shared-prefix-that-is-long-enough-to-be-truncated-before-the-hash-suffix-is-appended';
    const a = `${base}-AAAAAAAAAAAAAAAAAAAA`;
    const b = `${base}-BBBBBBBBBBBBBBBBBBBB`;
    const uidA = generateScenarioDashboardUid(a);
    const uidB = generateScenarioDashboardUid(b);
    expect(uidA.length).toBeLessThanOrEqual(MAX_UID_LENGTH);
    expect(uidB.length).toBeLessThanOrEqual(MAX_UID_LENGTH);
    expect(uidA).not.toBe(uidB);
  });

  it('appends an 8-char hash suffix only when truncation is needed', () => {
    // A name exactly at the boundary stays unchanged; one char longer gets hashed.
    const fitName = 'a'.repeat(MAX_UID_LENGTH - PREFIX.length); // total === 100
    const fitUid = generateScenarioDashboardUid(fitName);
    expect(fitUid).toBe(`${PREFIX}${fitName}`);
    expect(fitUid.length).toBe(MAX_UID_LENGTH);

    const overflowName = 'a'.repeat(MAX_UID_LENGTH - PREFIX.length + 1); // total === 101
    const overflowUid = generateScenarioDashboardUid(overflowName);
    expect(overflowUid.length).toBe(MAX_UID_LENGTH);
    // ends with "-<8 hex>"
    expect(overflowUid).toMatch(/-[0-9a-f]{8}$/);
  });

  it('does not leave a double hyphen when the truncation lands on a hyphen', () => {
    // Construct a name whose sanitized truncation boundary is a hyphen.
    const name = `${'word-'.repeat(40)}end`;
    const uid = generateScenarioDashboardUid(name);
    expect(uid.length).toBeLessThanOrEqual(MAX_UID_LENGTH);
    expect(uid).not.toContain('--');
  });
});

describe('generateScenarioDashboardUuid', () => {
  it('is deterministic and well-formed regardless of scenario name length', () => {
    const longName = 'x'.repeat(300);
    const a = generateScenarioDashboardUuid('sut-1', 'production', longName);
    const b = generateScenarioDashboardUuid('sut-1', 'production', longName);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
