'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { authenticatedFetch } from '@/lib/api';
import { parseSseChunk } from './sse';

interface LogContainer { id: string; name: string; service: string; state: string }

export default function LogsPage() {
  const [containers, setContainers] = useState<LogContainer[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [tail, setTail] = useState(100);
  const [follow, setFollow] = useState(true);
  const [filter, setFilter] = useState('');
  const [lines, setLines] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    authenticatedFetch('/logs/containers')
      .then((r) => (r.ok ? r.json() : []))
      .then(setContainers)
      .catch(() => setContainers([]));
  }, []);

  const stopStream = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  useEffect(() => {
    if (!selected) return;
    stopStream();
    setLines([]);
    const ac = new AbortController();
    abortRef.current = ac;
    (async () => {
      const res = await authenticatedFetch(
        `/logs/containers/${selected}/stream?tail=${tail}&follow=${follow}`,
        { signal: ac.signal },
      );
      if (!res.ok) return;
      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buffer = '';
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { lines: newLines, rest } = parseSseChunk(buffer);
        buffer = rest;
        if (newLines.length) setLines((prev) => [...prev, ...newLines].slice(-5000));
      }
    })().catch((err: unknown) => {
      // AbortError is expected when the stream is stopped/switched; ignore it.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error('Log stream error:', err);
    });
    return stopStream;
  }, [selected, tail, follow, stopStream]);

  const visible = filter ? lines.filter((l) => l.includes(filter)) : lines;

  const download = () => {
    const blob = new Blob([visible.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selected ?? 'logs'}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: 'flex', gap: 16, height: '80vh' }}>
      <aside style={{ width: 240, overflow: 'auto' }}>
        <h3>Components</h3>
        {containers.map((c) => (
          <button
            key={c.id}
            onClick={() => setSelected(c.id)}
            style={{ display: 'block', width: '100%', textAlign: 'left', fontWeight: selected === c.id ? 700 : 400 }}
          >
            {c.service || c.name} <small>({c.state})</small>
          </button>
        ))}
      </aside>
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <select value={tail} onChange={(e) => setTail(Number(e.target.value))}>
            <option value={100}>100</option>
            <option value={500}>500</option>
            <option value={1000}>1000</option>
          </select>
          <label><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> follow</label>
          <input placeholder="filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <button onClick={() => setLines([])}>clear</button>
          <button onClick={download} disabled={!visible.length}>download</button>
        </div>
        <pre style={{ flex: 1, overflow: 'auto', background: '#111', color: '#eee', padding: 8, fontSize: 12 }}>
          {visible.join('\n')}
        </pre>
      </main>
    </div>
  );
}
