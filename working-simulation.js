#!/usr/bin/env node

const API_URL = 'http://localhost:3001/api/test-runs/update-running';
const UPDATE_INTERVAL = 15 * 1000; // 15 seconds
const TEST_DURATION = 60 * 1000; // 1 minute

// Generate unique test run ID
const testRunId = `working-simulation-${Date.now()}`;
const startTime = new Date().toISOString();

console.log(`🚀 Starting WORKING test simulation: ${testRunId}`);
console.log(`📅 Start time: ${startTime}`);
console.log(`⏱️  Updates every 15s, completing after 1 minute`);
console.log(`✅ Upsert is now working - test will update properly!\n`);

let updateCount = 0;
const maxUpdates = Math.floor(TEST_DURATION / UPDATE_INTERVAL); // 4 updates

const sendUpdate = async (completed = false) => {
  updateCount++;
  
  const payload = {
    systemUnderTest: "Working Demo Service",
    testEnvironment: "staging",
    workload: "working-real-time-test", 
    testRunId: testRunId,
    start: startTime,
    duration: "60", // 60 seconds planned
    rampUp: "5",
    completed: completed,
    version: "v3.0.0",
    annotations: completed 
      ? "✅ Test completed successfully after 1 minute with 4 updates" 
      : `📡 Update ${updateCount}/${maxUpdates} - Live heartbeat every 15s`,
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
      const status = completed ? '🏁' : '💚';
      const action = completed ? 'COMPLETED' : `HEARTBEAT ${updateCount}`;
      console.log(`${status} ${action} - End Time: ${result.end_time}`);
      if (completed) {
        console.log(`🎉 Test finished successfully!`);
        console.log(`📊 Final duration: ${result.duration}s`);
      }
    } else {
      console.error(`❌ Failed to send update: ${response.status} ${response.statusText}`);
    }
  } catch (error) {
    console.error(`❌ Error sending update:`, error.message);
  }
};

// Send initial update
console.log('📡 Sending initial heartbeat...');
sendUpdate(false);

// Set up interval for regular updates
const updateInterval = setInterval(async () => {
  if (updateCount >= maxUpdates) {
    clearInterval(updateInterval);
    // Send final completion update
    console.log('🏁 Sending completion signal...');
    await sendUpdate(true);
    console.log('\n🎊 Simulation complete!');
    console.log('🖥️  Check the frontend - you should see:');
    console.log('   • Test shows as "Running" during updates');
    console.log('   • Duration increases in real-time'); 
    console.log('   • After completion, shows as "Completed"');
    console.log('   • Progress bar reaches 100%');
    process.exit(0);
  } else {
    console.log(`📡 Sending heartbeat ${updateCount + 1}/${maxUpdates}...`);
    await sendUpdate(false);
  }
}, UPDATE_INTERVAL);

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Simulation interrupted - cleaning up...');
  clearInterval(updateInterval);
  process.exit(0);
});

console.log('🎯 Simulation running... Watch the frontend for real-time updates!');
console.log('   http://localhost:3000/test-runs');
console.log('🛑 Press Ctrl+C to stop early\n');