// Grafana service exports
//
// `./auth` is deliberately NOT re-exported here. This barrel pulls in client.ts, which
// imports axios, and apps/grafana-sync does not declare axios -- importing the barrel
// there resolves only through npm hoisting, while passing check:workspace-exports, tsc
// and every test, and then fails at container boot. Import the leaf instead:
// `@perfana/shared/services/grafana/auth` (declared in package.json exports).
export * from './types';
export * from './client';
export * from './batching';
export * from './formatter';
