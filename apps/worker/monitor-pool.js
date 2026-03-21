#!/usr/bin/env node

import { Pool } from 'pg';

const pool = new Pool({
  connectionString: 'postgresql://postgres:postgres@localhost:54322/postgres',
  max: 100,
  connectionTimeoutMillis: 10000,
});

console.log('=== pg Pool Monitor ===');
console.log('Press Ctrl+C to stop\n');

setInterval(() => {
  const time = new Date().toLocaleTimeString();
  console.log(`=== ${time} ===`);
  console.log(`Max pool size: ${pool.options.max}`);
  console.log(`Total clients: ${pool.totalCount}`);
  console.log(`Idle clients:  ${pool.idleCount}`);
  console.log(`Active clients: ${pool.totalCount - pool.idleCount}`);
  console.log(`Waiting requests: ${pool.waitingCount}`);
  console.log('');
}, 2000);

// Keep the process alive
process.on('SIGINT', async () => {
  console.log('\nShutting down pool monitor...');
  await pool.end();
  process.exit(0);
});
