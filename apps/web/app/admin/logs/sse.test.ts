import { parseSseChunk } from './sse';

describe('parseSseChunk', () => {
  it('extracts complete data: events and keeps the trailing partial', () => {
    const { lines, rest } = parseSseChunk('data: one\n\ndata: two\n\ndata: par');
    expect(lines).toEqual(['one', 'two']);
    expect(rest).toBe('data: par');
  });

  it('returns no lines when no event is complete', () => {
    const { lines, rest } = parseSseChunk('data: half');
    expect(lines).toEqual([]);
    expect(rest).toBe('data: half');
  });
});
