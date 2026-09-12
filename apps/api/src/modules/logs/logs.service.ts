import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Docker from 'dockerode';
import { Readable, Transform, TransformCallback, pipeline } from 'stream';

export interface LogContainer {
  id: string;
  name: string;
  service: string;
  state: string;
}

/**
 * Docker multiplexes stdout/stderr into 8-byte-headed frames. Not docker-modem's demuxStream:
 * that one attaches a flowing 'data' listener and ignores write()'s return value, so a full
 * log downloaded over a slow link piles up in the PassThrough's buffer — the API-heap problem
 * this route exists to avoid. A Transform inherits backpressure from pipe(). Like the modem it
 * falls back to raw passthrough when the first header is not a frame (TTY containers).
 */
export class DockerLogDemux extends Transform {
  private buf: Buffer = Buffer.alloc(0);
  private raw = false;

  _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    if (this.raw) return cb(null, chunk);
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    let off = 0;
    while (this.buf.length - off >= 8) {
      const type = this.buf[off];
      const padded = this.buf[off + 1] === 0 && this.buf[off + 2] === 0 && this.buf[off + 3] === 0;
      if ((type !== 0 && type !== 1 && type !== 2) || !padded) {
        this.raw = true;
        this.push(this.buf.subarray(off));
        this.buf = Buffer.alloc(0);
        return cb();
      }
      const len = this.buf.readUInt32BE(off + 4);
      if (this.buf.length - off - 8 < len) break;
      this.push(this.buf.subarray(off + 8, off + 8 + len));
      off += 8 + len;
    }
    this.buf = this.buf.subarray(off);
    cb();
  }

  // A TTY log shorter than 8 bytes never reaches raw detection, and a truncated stream can end
  // mid-frame: push the remainder rather than drop it. 8+ bytes here is a validated header
  // with a short payload, so skip the header; fewer is a TTY log (or ≤7 bytes of header junk).
  _flush(cb: TransformCallback): void {
    const rest = !this.raw && this.buf.length >= 8 ? this.buf.subarray(8) : this.buf;
    if (rest.length) this.push(rest);
    this.buf = Buffer.alloc(0);
    cb();
  }
}

@Injectable()
export class LogsService {
  private readonly docker = new Docker(); // defaults to /var/run/docker.sock
  private readonly project: string;

  constructor(private readonly config: ConfigService) {
    this.project = this.config.get<string>('LOG_VIEWER_COMPOSE_PROJECT', 'perfana');
  }

  async listContainers(): Promise<LogContainer[]> {
    const containers = await this.docker.listContainers({
      all: false,
      filters: { label: [`com.docker.compose.project=${this.project}`] },
    });
    return containers.map((c) => ({
      id: c.Id,
      name: c.Names?.[0]?.replace(/^\//, '') ?? c.Id,
      service: c.Labels?.['com.docker.compose.service'] ?? '',
      state: c.State,
    }));
  }

  async openLogStream(id: string, opts: { tail: number | 'all'; follow: boolean }): Promise<Transform> {
    const allowed = await this.listContainers();
    if (!allowed.some((c) => c.id === id)) {
      throw new NotFoundException('Unknown container');
    }

    // Not container.logs(): dockerode buffers the whole body when follow is false, and a full
    // download of a container that has been up for weeks does not fit in the API's heap. Going
    // through the modem with isStream:true gives a stream that ends when the daemon is done.
    const srcStream = await new Promise<Readable>((resolve, reject) =>
      this.docker.modem.dial(
        {
          // The trailing '?' is docker-modem's cue to serialise `options` into the query string.
          path: `/containers/${id}/logs?`,
          method: 'GET',
          isStream: true,
          statusCodes: { 200: true, 404: 'no such container', 500: 'server error' },
          options: { follow: opts.follow, tail: opts.tail, stdout: true, stderr: true, timestamps: false },
        },
        (err: Error | null, data: unknown) => (err ? reject(err) : resolve(data as Readable)),
      ),
    );

    const out = new DockerLogDemux();
    // pipeline destroys both ends on error or when the consumer closes, so a client hanging up
    // releases the daemon connection.
    pipeline(srcStream, out, () => undefined);
    return out;
  }
}
