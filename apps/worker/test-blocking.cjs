const { Queue, Worker } = require("bullmq");
const IORedis = require("ioredis");

const connection = new IORedis({ host: "127.0.0.1", port: 6379, maxRetriesPerRequest: null });
const blockingConnection = new IORedis({ host: "127.0.0.1", port: 6379, maxRetriesPerRequest: null });

const queueName = "test-queue";

async function main() {
  const queue = new Queue(queueName, { connection });

  const worker = new Worker(
    queueName,
    async job => {
      console.log(`[${new Date().toISOString()}] 🚀 Picked up job:`, job.id, job.data);
    },
    {
      connection,
      blockingConnection,
      concurrency: 1,
      drainDelay: 100,
    }
  );

  worker.on("ready", async () => {
    console.log(`[${new Date().toISOString()}] ✅ Worker ready, enqueueing job in 2s...`);
    setTimeout(async () => {
      console.log(`[${new Date().toISOString()}] ➕ Adding job`);
      await queue.add("test-job", { foo: "bar" });
    }, 2000);
  });
}

main().catch(console.error);
