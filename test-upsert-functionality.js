#!/usr/bin/env node

const API_URL = 'http://localhost:3001/api/test-runs/update-running';

// Test the upsert functionality by trying to update an existing test run
const testUpsert = async () => {
  console.log('🧪 Testing backend upsert functionality...\n');

  // Get an existing test run ID to update
  const existingTestRunId = 'live-test-1756211482506'; // One we created earlier
  
  console.log(`📝 Attempting to update existing test: ${existingTestRunId}`);
  
  const payload = {
    systemUnderTest: "Live Active Service",
    testEnvironment: "production", 
    workload: "live-active-test",
    testRunId: existingTestRunId,
    duration: "180",
    rampUp: "15", 
    completed: false,
    version: "v2.1.0", // Changed version to see update
    annotations: "🔄 UPSERT TEST - This should UPDATE the existing test run",
    variables: []
  };

  try {
    console.log('⏳ Sending update request...');
    
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      const result = await response.json();
      console.log('✅ SUCCESS: Upsert worked! Test run was updated.');
      console.log(`📊 Updated test run ID: ${result.test_run_id}`);
      console.log(`🆕 New version: ${result.application_release}`);
      console.log(`📝 New annotations: ${result.annotations?.[0]}`);
    } else {
      console.log('❌ FAILED: Upsert still not working');
      const errorResponse = await response.text();
      console.log(`Status: ${response.status} ${response.statusText}`);
      if (errorResponse.includes('duplicate key value')) {
        console.log('🔧 Backend still has upsert constraint issue');
      }
      console.log('Error details:', errorResponse.substring(0, 200) + '...');
    }
  } catch (error) {
    console.error('❌ Network error:', error.message);
  }
};

testUpsert();