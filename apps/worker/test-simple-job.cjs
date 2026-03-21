const { Queue } = require("bullmq");
const IORedis = require("ioredis");

const connection = new IORedis({ host: "127.0.0.1", port: 6379, maxRetriesPerRequest: null });

async function main() {
  // Use the NEW perfana-analyze queue (not the old perfana-processing)
  const queue = new Queue("perfana-analyze", { connection, prefix: "bull" });

  console.log(`[${new Date().toISOString()}] ➕ Adding checks-evaluation job to perfana-analyze queue`);
  console.log(`[${new Date().toISOString()}] 📊 Testing simplified BullMQ with BRPOPLPUSH blocking mode`);

  const job = await queue.add(
    "checks-evaluation",
    {
      testRunIds: ["simple-blocking-test"],
      batchId: "simple-test-" + Date.now()
    },
    { attempts: 1 }  // NO priority field!
  );

  console.log(`[${new Date().toISOString()}] ✅ Job added with ID: ${job.id}`);
  console.log(`[${new Date().toISOString()}] ⏱️  Timestamp: ${job.timestamp}`);

  // Wait a moment to see the worker pick it up
  await new Promise(resolve => setTimeout(resolve, 500));

  // Get job status
  const jobData = await queue.getJob(job.id);
  if (jobData) {
    const state = await jobData.getState();
    console.log(`[${new Date().toISOString()}] 📈 Job state: ${state}`);

    if (jobData.processedOn && jobData.timestamp) {
      const pickupTime = jobData.processedOn - jobData.timestamp;
      console.log(`[${new Date().toISOString()}] ⚡ Pickup time: ${pickupTime}ms`);

      if (pickupTime < 10) {
        console.log(`[${new Date().toISOString()}] ✅ SUCCESS: Pickup time < 10ms (BRPOPLPUSH working!)`);
      } else if (pickupTime < 100) {
        console.log(`[${new Date().toISOString()}] ⚠️  WARNING: Pickup time ${pickupTime}ms (acceptable but not optimal)`);
      } else {
        console.log(`[${new Date().toISOString()}] ❌ FAILURE: Pickup time ${pickupTime}ms (BRPOPLPUSH not working)`);
      }
    }
  }

  await connection.quit();
}

main().catch(console.error);
