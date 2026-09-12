import { authenticatedFetch } from '@/lib/api';
import { pickDiskSink, readWithProgress } from '@/app/systems/[id]/config/components/ExportSystemDialog';

/**
 * Download a container's complete log, gzipped server-side. Same shape as the SUT export:
 * stream to disk where the browser can (Chrome/Edge), otherwise buffer a Blob — a container up
 * for weeks may not fit in the tab. Resolves silently when the user dismisses the save dialog;
 * throws with a user-facing message on any other failure. Must be called from a click handler:
 * the picker needs transient user activation.
 */
export async function downloadContainerLog(containerId: string, filename: string): Promise<void> {
  let sink: Awaited<ReturnType<typeof pickDiskSink>> = null;
  try {
    sink = await pickDiskSink(filename, 'Gzipped log');
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') return;
    console.warn('Save picker unavailable — buffering the log in memory instead', err);
  }
  const controller = new AbortController();
  try {
    const res = await authenticatedFetch(`/logs/containers/${containerId}/download`, { signal: controller.signal });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.message || `Download failed (HTTP ${res.status})`);
    }
    const blob = await readWithProgress(res, () => undefined, sink);
    if (blob) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }
  } catch (err) {
    // Close the socket, not just the file — see ExportSystemDialog for why a stalled reader
    // keeps the server's docker connection open.
    controller.abort();
    await sink?.abort().catch(() => undefined);
    throw err;
  }
}
