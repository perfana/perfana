import { readWithProgress } from '../components/ExportSystemDialog';

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

describe('readWithProgress', () => {
  it('reports a monotonic running total and returns every byte', async () => {
    const chunk = new Uint8Array(300 * 1024); // above the 256 kB reporting step
    const seen: number[] = [];
    const blob = await readWithProgress(streamed([chunk, chunk]), (n) => seen.push(n));

    expect(blob.size).toBe(600 * 1024);
    expect(seen[seen.length - 1]).toBe(600 * 1024); // final total always reported
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });

  it('still reports the final total when every chunk is below the step', async () => {
    const seen: number[] = [];
    await readWithProgress(streamed([new Uint8Array(10), new Uint8Array(10)]), (n) => seen.push(n));

    expect(seen).toEqual([20]);
  });

  it('falls back to blob() when the response has no body stream', async () => {
    const response = { blob: async () => new Blob(['abc']) } as unknown as Response;
    const seen: number[] = [];

    expect((await readWithProgress(response, (n) => seen.push(n))).size).toBe(3);
    expect(seen).toEqual([]);
  });
});
