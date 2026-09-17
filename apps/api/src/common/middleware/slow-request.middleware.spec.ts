import { EventEmitter } from 'node:events';
import { SlowRequestMiddleware } from './slow-request.middleware';

/** Fake Express response: `finish(status)` mimics a completed write, `abort()` a client hang-up. */
const fakeRes = (headers: Record<string, string> = {}) => {
  const res = Object.assign(new EventEmitter(), {
    statusCode: 200,
    writableFinished: false,
    getHeader: (k: string) => headers[k],
  });
  return {
    res,
    finish: (status = 200) => {
      res.statusCode = status;
      res.writableFinished = true;
      res.emit('close');
    },
    abort: () => res.emit('close'),
  };
};

const flush = () => new Promise((r) => setImmediate(r)); // describeActiveJobs is awaited off the request path

describe('SlowRequestMiddleware', () => {
  const pool = { totalCount: 50, idleCount: 0, waitingCount: 3 };
  const dataSource = { driver: { master: pool } } as never;
  const config = (env: Record<string, string | undefined> = {}) => ({ get: (k: string) => env[k] }) as never;
  const bullmq = { describeActiveJobs: jest.fn() };
  const req = (over: Record<string, string> = {}) => ({ method: 'GET', originalUrl: '/api/test-runs', ...over }) as never;
  let now = 0;
  const elapse = (ms: number) => (now += ms);

  const build = (threshold?: string, ds = dataSource) => {
    const mw = new SlowRequestMiddleware(config({ SLOW_REQUEST_MS: threshold }), ds, bullmq as never);
    const warn = jest.spyOn((mw as never as { logger: { warn: jest.Mock } }).logger, 'warn').mockImplementation();
    return { mw, warn };
  };

  beforeEach(() => {
    now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    bullmq.describeActiveJobs.mockReset().mockResolvedValue('analyze-test#1(RUN-1)');
    pool.waitingCount = 3;
  });
  afterEach(() => jest.restoreAllMocks());

  it('logs status, pool state and active jobs when the response closes slowly', async () => {
    const { mw, warn } = build();
    const { res, finish } = fakeRes();
    const next = jest.fn();

    mw.use(req(), res as never, next);
    expect(next).toHaveBeenCalled();
    elapse(1500);
    finish(201); // status is set AFTER the handler, by @HttpCode / exception filters
    await flush();

    expect(warn).toHaveBeenCalledWith('GET /api/test-runs 201 1500ms pool=50/0idle/3waiting jobs=analyze-test#1(RUN-1)');
  });

  it('stays silent under the threshold and never touches Redis', async () => {
    const { mw, warn } = build();
    const { res, finish } = fakeRes();

    mw.use(req(), res as never, jest.fn());
    elapse(999);
    finish();
    await flush();

    expect(warn).not.toHaveBeenCalled();
    expect(bullmq.describeActiveJobs).not.toHaveBeenCalled();
  });

  it('snapshots the pool at close time, not after the Redis round trip', async () => {
    let resolveJobs!: (v: string) => void;
    bullmq.describeActiveJobs.mockReturnValue(new Promise<string>((r) => (resolveJobs = r)));
    const { mw, warn } = build();
    const { res, finish } = fakeRes();

    mw.use(req(), res as never, jest.fn());
    elapse(2000);
    finish();
    pool.waitingCount = 0; // pool recovers while Redis is still answering
    resolveJobs('none');
    await flush();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('pool=50/0idle/3waiting'));
  });

  it('logs "aborted" when the client hangs up before the response finished', async () => {
    const { mw, warn } = build();
    const { res, abort } = fakeRes();

    mw.use(req(), res as never, jest.fn());
    elapse(5000);
    abort();
    await flush();

    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^GET \/api\/test-runs aborted 5000ms /));
  });

  it('ignores an SSE stream, which is open for as long as it is watched', async () => {
    const { mw, warn } = build();
    const { res, abort } = fakeRes({ 'content-type': 'text/event-stream' });

    mw.use(req({ originalUrl: '/api/logs/containers/x/stream' }), res as never, jest.fn());
    elapse(60_000);
    abort();
    await flush();

    expect(warn).not.toHaveBeenCalled();
  });

  it('logs pool=n/a when the driver exposes no pg pool', async () => {
    const { mw, warn } = build(undefined, { driver: {} } as never);
    const { res, finish } = fakeRes();

    mw.use(req(), res as never, jest.fn());
    elapse(1500);
    finish();
    await flush();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining(' pool=n/a jobs='));
  });

  it('honours SLOW_REQUEST_MS', async () => {
    const { mw, warn } = build('5000');
    const { res, finish } = fakeRes();

    mw.use(req(), res as never, jest.fn());
    elapse(4000);
    finish();
    await flush();

    expect(warn).not.toHaveBeenCalled();
  });

  it.each(['abc', '', '0', '-1', undefined])('treats SLOW_REQUEST_MS=%j as the 1000ms default instead of logging everything', async (v) => {
    const { mw, warn } = build(v);
    const { res, finish } = fakeRes();

    mw.use(req(), res as never, jest.fn());
    elapse(500);
    finish();
    await flush();

    expect(warn).not.toHaveBeenCalled();
  });

  it('survives a throw inside the log callback without an unhandled rejection', async () => {
    const { mw, warn } = build();
    warn.mockImplementation(() => {
      throw new Error('logger down');
    });
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    const { res, finish } = fakeRes();

    mw.use(req(), res as never, jest.fn());
    elapse(1500);
    finish();
    await flush();
    await flush();
    process.off('unhandledRejection', unhandled);

    expect(unhandled).not.toHaveBeenCalled();
  });
});
