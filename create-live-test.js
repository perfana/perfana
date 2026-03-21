#!/usr/bin/env node

const API_URL = 'http://localhost:3001/api/test-runs/update-running';

// Create a test that will be "live" by creating it with current timestamp
const testRunId = `live-test-${Date.now()}`;
const now = new Date();
const startTime = now.toISOString();

console.log(`🚀 Creating live test that should show as "Running": ${testRunId}`);
console.log(`📅 Start time: ${startTime}`);
console.log(`⏱️  This test has current timestamp and should show as active/running\n`);

const createLiveTest = async () => {
  const payload = {
    systemUnderTest: "Live Active Service",
    testEnvironment: "production",
    workload: "live-active-test", 
    testRunId: testRunId,
    start: startTime,
    duration: "180", // 3 minutes planned
    rampUp: "15",
    completed: false,
    version: "v2.0.0",
    annotations: "Live test - should show as Running with current timestamp",
    variables: []
  };

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
      console.log(`✅ Live test created: ${testRunId}`);
      console.log(`🎯 Check the frontend - this should show as "Running" (green badge)`);
      console.log(`📊 Progress bar should show current progress`);
      console.log(`🔝 Should appear at the top of the test runs list`);
    } else {
      console.error(`❌ Failed to create live test: ${response.status} ${response.statusText}`);
      const errorText = await response.text();
      console.error(`Error details: ${errorText}`);
    }
  } catch (error) {
    console.error(`❌ Error creating live test:`, error.message);
  }
};

createLiveTest();