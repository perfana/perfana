#!/usr/bin/env node

const API_URL = 'http://localhost:3001/api/test-runs/update-running';

console.log('🎬 Creating a test that will complete in 45 seconds...\n');

// First create a running test
const testRunId = `completing-test-${Date.now()}`;
const startTime = new Date().toISOString();

const createRunningTest = async () => {
  const payload = {
    systemUnderTest: "Completing Demo Service",
    testEnvironment: "demo",
    workload: "completion-demo", 
    testRunId: testRunId,
    start: startTime,
    duration: "60", // 1 minute planned
    rampUp: "5",
    completed: false,
    version: "v1.5.0",
    annotations: "Running test - will complete in 45 seconds",
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
      console.log(`✅ Running test created: ${testRunId}`);
      console.log(`⏳ Will complete in 45 seconds...`);
      
      // Set timeout to complete the test
      setTimeout(async () => {
        await completeTest();
      }, 45000);
      
    } else {
      console.error(`❌ Failed to create test: ${response.status} ${response.statusText}`);
    }
  } catch (error) {
    console.error(`❌ Error creating test:`, error.message);
  }
};

const completeTest = async () => {
  const endTime = new Date().toISOString();
  
  // Since upsert doesn't work, create a new "completed" test with same ID but different payload
  const payload = {
    systemUnderTest: "Completing Demo Service",
    testEnvironment: "demo",
    workload: "completion-demo-completed", // Different workload to avoid constraint
    testRunId: `${testRunId}-completed`,
    start: startTime,
    end: endTime,
    duration: "45", // Actual duration 
    rampUp: "5",
    completed: true,
    version: "v1.5.0", 
    annotations: "✅ Test completed successfully - was running for 45 seconds",
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
      console.log(`🎉 Test completed: ${testRunId}-completed`);
      console.log(`🔚 End time: ${endTime}`);
      console.log(`✨ Check frontend - should show as "Completed" with green badge`);
    } else {
      console.error(`❌ Failed to complete test: ${response.status} ${response.statusText}`);
    }
  } catch (error) {
    console.error(`❌ Error completing test:`, error.message);
  }
};

createRunningTest();