import { downloadContainerLog } from './download';
import { authenticatedFetch } from '@/lib/api';
import { pickDiskSink, readWithProgress } from '@/app/systems/[id]/config/components/ExportSystemDialog';

jest.mock('@/lib/api', () => ({ authenticatedFetch: jest.fn() }));
jest.mock('@/app/systems/[id]/config/components/ExportSystemDialog', () => ({
  pickDiskSink: jest.fn(),
  readWithProgress: jest.fn(),
}));

const fetchMock = authenticatedFetch as jest.Mock;
const pickMock = pickDiskSink as jest.Mock;
const readMock = readWithProgress as jest.Mock;

function abortError() {
  const err = new Error('cancelled');
  err.name = 'AbortError';
  return err;
}

describe('downloadContainerLog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('is a silent no-op when the save dialog is dismissed', async () => {
    pickMock.mockRejectedValue(abortError());
    await expect(downloadContainerLog('c1', 'api.log.gz')).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to a Blob and clicks an anchor when there is no picker', async () => {
    pickMock.mockResolvedValue(null);
    fetchMock.mockResolvedValue({ ok: true });
    readMock.mockResolvedValue(new Blob(['x']));
    const click = jest.fn();
    jest.spyOn(document, 'createElement').mockReturnValue({ click, remove: jest.fn() } as unknown as HTMLElement);
    jest.spyOn(document.body, 'appendChild').mockImplementation((n) => n);
    URL.createObjectURL = jest.fn(() => 'blob:1');
    URL.revokeObjectURL = jest.fn();
    await downloadContainerLog('c1', 'api.log.gz');
    expect(fetchMock).toHaveBeenCalledWith('/logs/containers/c1/download', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(readMock).toHaveBeenCalledWith({ ok: true }, expect.any(Function), null);
    expect(click).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:1');
  });

  it('streams to the sink and clicks nothing', async () => {
    const sink = { write: jest.fn(), close: jest.fn(), abort: jest.fn() };
    pickMock.mockResolvedValue(sink);
    fetchMock.mockResolvedValue({ ok: true });
    readMock.mockResolvedValue(null);
    const createElement = jest.spyOn(document, 'createElement');
    await downloadContainerLog('c1', 'api.log.gz');
    expect(pickMock).toHaveBeenCalledWith('api.log.gz', 'Gzipped log');
    expect(readMock).toHaveBeenCalledWith({ ok: true }, expect.any(Function), sink);
    expect(createElement).not.toHaveBeenCalled();
    expect(sink.abort).not.toHaveBeenCalled();
  });

  it('surfaces the server message and gives the file back on a non-ok response', async () => {
    const sink = { write: jest.fn(), close: jest.fn(), abort: jest.fn().mockResolvedValue(undefined) };
    pickMock.mockResolvedValue(sink);
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: () => Promise.resolve({ message: 'Log viewer is disabled' }) });
    await expect(downloadContainerLog('c1', 'api.log.gz')).rejects.toThrow('Log viewer is disabled');
    expect(sink.abort).toHaveBeenCalled();
    expect(readMock).not.toHaveBeenCalled();
  });

  it('falls back to the HTTP status when the error body is not JSON', async () => {
    pickMock.mockResolvedValue(null);
    fetchMock.mockResolvedValue({ ok: false, status: 502, json: () => Promise.reject(new Error('html')) });
    await expect(downloadContainerLog('c1', 'api.log.gz')).rejects.toThrow('Download failed (HTTP 502)');
  });

  it('aborts the fetch when the read fails mid-stream', async () => {
    pickMock.mockResolvedValue(null);
    fetchMock.mockResolvedValue({ ok: true });
    readMock.mockRejectedValue(new Error('disk full'));
    await expect(downloadContainerLog('c1', 'api.log.gz')).rejects.toThrow('disk full');
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    expect(signal.aborted).toBe(true);
  });
});
