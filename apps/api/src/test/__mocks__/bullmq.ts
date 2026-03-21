// Mock for BullMQ to avoid Redis dependency in tests

export class Queue {
  name: string;

  constructor(name: string) {
    this.name = name;
  }

  add = jest.fn().mockResolvedValue({ id: 'mock-job-id' });

  on = jest.fn();
  off = jest.fn();
  close = jest.fn().mockResolvedValue(undefined);

  getJobs = jest.fn().mockResolvedValue([]);
  getJob = jest.fn().mockResolvedValue(null);

  obliterate = jest.fn().mockResolvedValue(undefined);
  drain = jest.fn().mockResolvedValue(undefined);
  clean = jest.fn().mockResolvedValue([]);

  isPaused = jest.fn().mockResolvedValue(false);
  pause = jest.fn().mockResolvedValue(undefined);
  resume = jest.fn().mockResolvedValue(undefined);
}

export class Worker {
  constructor(_name: string, _processor: any, _opts?: any) {}

  on = jest.fn();
  off = jest.fn();
  close = jest.fn().mockResolvedValue(undefined);

  pause = jest.fn().mockResolvedValue(undefined);
  resume = jest.fn().mockResolvedValue(undefined);
  isPaused = jest.fn().mockResolvedValue(false);
}

export class QueueScheduler {
  constructor(_name: string, _opts?: any) {}

  on = jest.fn();
  off = jest.fn();
  close = jest.fn().mockResolvedValue(undefined);
}

export class FlowProducer {
  constructor(_opts?: any) {}

  add = jest.fn().mockResolvedValue({ job: { id: 'mock-flow-job-id' } });
  close = jest.fn().mockResolvedValue(undefined);
}