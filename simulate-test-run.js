#!/usr/bin/env node

const API_URL = 'http://localhost:3001/api/test-runs/update-running';
const UPDATE_INTERVAL = 15 * 1000; // 15 seconds
const TEST_DURATION = 60 * 1000; // 1 minute

// Generate unique test run ID
const testRunId = `simulation-${Date.now()}`;
const startTime = new Date().toISOString();

console.log(`🚀 Starting test simulation: ${testRunId}`);
console.log(`📅 Start time: ${startTime}`);
console.log(`⏱️  Updates every 15s, completing after 1 minute\n`);

let updateCount = 0;
const maxUpdates = Math.floor(TEST_DURATION / UPDATE_INTERVAL); // 4 updates

const sendUpdate = async (completed = false) => {
  updateCount++;
  
  const payload = {
    systemUnderTest: "Live Demo Service",
    testEnvironment: "staging",
    workload: "real-time-test", 
    testRunId: testRunId,
    start: startTime,
    duration: "60", // 60 seconds planned
    rampUp: "5",
    completed: completed,
    version: "v1.0.0",
    annotations: completed 
      ? "Test completed successfully - should show as completed" 
      : `Update ${updateCount}/${maxUpdates} - should show as running`,
    variables: []
  };

  if (completed) {
    payload.end = new Date().toISOString();
  }

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      const result = await response.json();
      const status = completed ? '✅' : '🔄';
      const action = completed ? 'COMPLETED' : `UPDATE ${updateCount}`;
      console.log(`${status} ${action} - Test ID: ${testRunId}`);
      if (completed) {
        console.log(`🎉 Test finished at: ${payload.end}`);
      }
    } else {
      console.error(`❌ Failed to send update: ${response.status} ${response.statusText}`);
    }
  } catch (error) {
    console.error(`❌ Error sending update:`, error.message);
  }
};

// Send initial update
sendUpdate(false);

// Set up interval for regular updates
const updateInterval = setInterval(async () => {
  if (updateCount >= maxUpdates) {
    clearInterval(updateInterval);
    // Send final completion update
    await sendUpdate(true);
    console.log('\n🏁 Simulation complete!');
    console.log('💡 Check the frontend - test should transition from Running → Completed');
    process.exit(0);
  } else {
    await sendUpdate(false);
  }
}, UPDATE_INTERVAL);

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Simulation interrupted - cleaning up...');
  clearInterval(updateInterval);
  process.exit(0);
});

console.log('🎯 Simulation running... Press Ctrl+C to stop early');