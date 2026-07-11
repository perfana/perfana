import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Docker from 'dockerode';
import { PassThrough, Readable } from 'stream';

export interface LogContainer {
  id: string;
  name: string;
  service: string;
  state: string;
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

  async openLogStream(id: string, opts: { tail: number; follow: boolean }): Promise<PassThrough> {
    const allowed = await this.listContainers();
    if (!allowed.some((c) => c.id === id)) {
      throw new NotFoundException('Unknown container');
    }

    const container = this.docker.getContainer(id);
    const source = await container.logs({
      follow: opts.follow,
      tail: opts.tail,
      stdout: true,
      stderr: true,
      timestamps: false,
    } as unknown as any);

    // follow:true -> a live stream; follow:false -> a Buffer. Normalize to a Readable.
    const srcStream: Readable = opts.follow ? (source as unknown as Readable) : Readable.from(source as unknown as Buffer);

    const out = new PassThrough();
    this.docker.modem.demuxStream(srcStream, out, out);
    srcStream.on('end', () => out.end());
    srcStream.on('error', (err) => out.destroy(err));
    out.on('close', () => {
      const s = srcStream as unknown as { destroy?: () => void };
      if (typeof s.destroy === 'function') s.destroy();
    });
    return out;
  }
}
