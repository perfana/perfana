#!/usr/bin/env node

const API_URL = 'http://localhost:3001/api/test-runs/update-running';

// Generate unique test run ID  
const testRunId = `demo-stale-test-${Date.now()}`;
const startTime = new Date().toISOString();

console.log(`🚀 Creating demo test that will become stale: ${testRunId}`);
console.log(`📅 Start time: ${startTime}`);
console.log(`⏱️  This test will show as "Running" initially, then become "Stale" after 30 seconds\n`);

const createTest = async () => {
  const payload = {
    systemUnderTest: "Demo Stale Detection Service",
    testEnvironment: "demo",
    workload: "stale-detection-test", 
    testRunId: testRunId,
    start: startTime,
    duration: "300", // 5 minutes planned
    rampUp: "30",
    completed: false,
    version: "v1.0.0",
    annotations: "Demo test - watch it transition from Running to Stale in real-time",
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
      console.log(`✅ Demo test created: ${testRunId}`);
      console.log(`🎯 Check the frontend at http://localhost:3000/test-runs`);
      console.log(`⏳ The test should show as "Running" initially`);
      console.log(`🔄 After 30 seconds, it will automatically change to "Stale"`);
      console.log(`📱 The frontend updates every 5 seconds automatically`);
    } else {
      console.error(`❌ Failed to create test: ${response.status} ${response.statusText}`);
      const errorText = await response.text();
      console.error(`Error details: ${errorText}`);
    }
  } catch (error) {
    console.error(`❌ Error creating test:`, error.message);
  }
};

createTest();