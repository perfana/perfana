const { Queue } = require("bullmq");
const IORedis = require("ioredis");

const connection = new IORedis({ host: "127.0.0.1", port: 6379, maxRetriesPerRequest: null });

async function main() {
  const queue = new Queue("perfana-processing", { connection });

  console.log(`[${new Date().toISOString()}] ➕ Adding test job to perfana-processing queue`);

  const job = await queue.add(
    "checks-evaluation",
    {
      testRunIds: ["test-blocking-check"],
      batchId: "test-batch-" + Date.now()
    },
    { attempts: 1 }
  );

  console.log(`[${new Date().toISOString()}] ✅ Job added with ID: ${job.id}`);

  await connection.quit();
}

main().catch(console.error);
