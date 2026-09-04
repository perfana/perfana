import { pickDiskSink, readWithProgress } from '../components/ExportSystemDialog';

/** Minimal stand-in for a streamed Response — jsdom has no ReadableStream. */
function streamed(chunks: Uint8Array[]): Response {
  let i = 0;
  return {
    body: {
      getReader: () => ({
        read: async () =>
          i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined },
      }),
    },
  } as unknown as Response;
}

function fakeSink() {
  const written: Uint8Array[] = [];
  return {
    written,
    write: jest.fn(async (c: Uint8Array) => { written.push(c); }),
    close: jest.fn(async () => undefined),
    abort: jest.fn(async () => undefined),
  };
}

describe('readWithProgress', () => {
  it('reports a monotonic running total and returns every byte', async () => {
    const chunk = new Uint8Array(300 * 1024); // above the 256 kB reporting step
    const seen: number[] = [];
    const blob = await readWithProgress(streamed([chunk, chunk]), (n) => seen.push(n));

    expect(blob).not.toBeNull();
    expect(blob!.size).toBe(600 * 1024);
    expect(seen[seen.length - 1]).toBe(600 * 1024); // final total always reported
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });

  it('still reports the final total when every chunk is below the step', async () => {
    const seen: number[] = [];
    await readWithProgress(streamed([new Uint8Array(10), new Uint8Array(10)]), (n) => seen.push(n));

    expect(seen).toEqual([20]);
  });

  it('streams to the sink in order and retains nothing when one is supplied', async () => {
    // Distinguishable chunks: equal-sized fixtures would pass even if a stale value were
    // written twice, which is exactly the bug the per-chunk write could introduce.
    const a = new Uint8Array(300 * 1024).fill(1);
    const b = new Uint8Array(260 * 1024).fill(2);
    const sink = fakeSink();
    const seen: number[] = [];

    const blob = await readWithProgress(streamed([a, b]), (n) => seen.push(n), sink);

    expect(blob).toBeNull(); // nothing buffered in the tab
    expect(sink.written).toEqual([a, b]);
    expect(sink.close).toHaveBeenCalled();
    expect(sink.abort).not.toHaveBeenCalled();
    expect(seen[seen.length - 1]).toBe(560 * 1024);
  });

  it('falls back to blob() when the response has no body stream', async () => {
    const response = { blob: async () => new Blob(['abc']) } as unknown as Response;
    const seen: number[] = [];

    const blob = await readWithProgress(response, (n) => seen.push(n));
    expect(blob).not.toBeNull();
    expect(blob!.size).toBe(3);
    expect(seen).toEqual([]);
  });

  it('gives the file back and throws when a sink was opened but there is no body stream', async () => {
    // Returning null here would close the dialog over the 0-byte file the picker created.
    const sink = fakeSink();
    const response = { blob: async () => new Blob(['abc']) } as unknown as Response;

    await expect(readWithProgress(response, () => {}, sink)).rejects.toThrow(/Chrome or Edge/);
    expect(sink.abort).toHaveBeenCalled();
    expect(sink.close).not.toHaveBeenCalled();
    expect(sink.write).not.toHaveBeenCalled();
  });
});

describe('pickDiskSink', () => {
  afterEach(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });

  it('returns null when the browser has no picker, so the caller buffers instead', async () => {
    await expect(pickDiskSink('a.ndjson.gz')).resolves.toBeNull();
  });

  it('passes the suggested name through and returns the writable', async () => {
    const writable = fakeSink();
    const picker = jest.fn(async () => ({ createWritable: async () => writable }));
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = picker;

    await expect(pickDiskSink('sut-x-2026-09-04.ndjson.gz')).resolves.toBe(writable);
    expect(picker).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedName: 'sut-x-2026-09-04.ndjson.gz' }),
    );
  });

  it('propagates AbortError so the caller can treat a dismissed dialog as a cancel', async () => {
    const err = Object.assign(new Error('cancel'), { name: 'AbortError' });
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker =
      jest.fn(async () => { throw err; });

    await expect(pickDiskSink('a.ndjson.gz')).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('propagates a non-abort rejection so the caller can log it and fall back', async () => {
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker =
      jest.fn(async () => { throw Object.assign(new Error('insecure'), { name: 'SecurityError' }); });

    await expect(pickDiskSink('a.ndjson.gz')).rejects.toMatchObject({ name: 'SecurityError' });
  });
});
