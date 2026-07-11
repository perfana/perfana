// Splits an SSE text buffer into complete `data:` payloads plus the leftover partial.
export function parseSseChunk(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  const lines = parts
    .map((p) => p.replace(/^data: ?/, ''))
    .filter((p) => p.length > 0);
  return { lines, rest };
}
