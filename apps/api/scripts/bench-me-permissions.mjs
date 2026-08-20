#!/usr/bin/env node
/**
 * Latency check for GET /api/users/me/permissions.
 *
 * The endpoint parallelises per-org capability lookups with Promise.all and uses
 * a versioned cache key (never redis.keys()). Both should keep p99 at roughly one
 * round trip regardless of how many organizations the user belongs to — but that
 * was reasoned, not measured. For a user with 20+ orgs (a realistic admin or
 * support account) a regression here would quietly add hundreds of ms to every
 * session start.
 *
 * Pass criterion, from TODOS.md: cold p99 < 200ms, warm p99 < 30ms.
 * Exits non-zero when either is missed, so it can gate a pipeline if wanted.
 *
 * Usage:
 *   PERFANA_TOKEN=<bearer> node scripts/bench-me-permissions.mjs
 *   PERFANA_TOKEN=<bearer> PERFANA_API=http://host:3001/api N=200 node scripts/bench-me-permissions.mjs
 *
 * Cold cache means an empty Redis for this user. Flush before running:
 *   docker exec perfana-redis redis-cli --scan --pattern 'auth:*' | xargs -r docker exec -i perfana-redis redis-cli DEL
 *
 * Deliberately sequential: the question is per-request latency, not throughput,
 * and concurrency would hide a serialised lookup behind overlapping waits.
 */

const API = process.env.PERFANA_API || 'http://localhost:3001/api';
const TOKEN = process.env.PERFANA_TOKEN;
const N = Number(process.env.N || 100);

const COLD_P99_MS = 200;
const WARM_P99_MS = 30;

if (!TOKEN) {
  console.error('PERFANA_TOKEN is required (a Keycloak bearer token or an API key).');
  process.exit(2);
}

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

async function run(label) {
  const timings = [];
  for (let i = 0; i < N; i++) {
    const started = performance.now();
    const res = await fetch(`${API}/users/me/permissions`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const elapsed = performance.now() - started;
    if (!res.ok) {
      console.error(`${label}: request ${i + 1} returned HTTP ${res.status}`);
      process.exit(1);
    }
    await res.arrayBuffer(); // drain, so the timing covers the whole response
    timings.push(elapsed);
  }

  timings.sort((a, b) => a - b);
  const stats = {
    p50: percentile(timings, 50),
    p95: percentile(timings, 95),
    p99: percentile(timings, 99),
    max: timings[timings.length - 1],
  };

  const fmt = v => `${v.toFixed(1)}ms`;
  console.log(
    `${label.padEnd(5)} n=${N}  p50=${fmt(stats.p50)}  p95=${fmt(stats.p95)}  ` +
      `p99=${fmt(stats.p99)}  max=${fmt(stats.max)}`,
  );
  return stats;
}

// The first pass is only cold for request #1 — every later one is served warm.
// Reporting it as "cold" is still the number that matters: it is what a user with
// an empty cache experiences at session start.
const cold = await run('cold');
const warm = await run('warm');

const failures = [];
if (cold.p99 >= COLD_P99_MS) failures.push(`cold p99 ${cold.p99.toFixed(1)}ms >= ${COLD_P99_MS}ms`);
if (warm.p99 >= WARM_P99_MS) failures.push(`warm p99 ${warm.p99.toFixed(1)}ms >= ${WARM_P99_MS}ms`);

if (failures.length) {
  console.error(`\nFAIL: ${failures.join('; ')}`);
  process.exit(1);
}

console.log('\nPASS: cold p99 < 200ms, warm p99 < 30ms');
