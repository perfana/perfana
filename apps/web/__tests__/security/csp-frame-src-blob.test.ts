/**
 * `frame-src` must allow `blob:` — in BOTH places that produce it.
 *
 * The report viewer and the public share page load the generated report into
 * their iframe from a `blob:` URL (not `srcDoc`, because an about:srcdoc document
 * inherits the parent's base URL and in-report anchor links then navigated the
 * iframe away). `'self'` does NOT cover `blob:`, so dropping it from either
 * producer blocks the iframe outright and every report renders as a blank frame —
 * with nothing failing in CI, because the CSP is a build artefact.
 *
 * The two producers are:
 *   1. next.config.js `getFrameSrc()` — baked into routes-manifest.json at build.
 *   2. scripts/start-server.js `patchCspHeaders()` — rewrites frame-src at
 *      container startup whenever NEXT_PUBLIC_CSP_FRAME_SRC is set, i.e. it
 *      OVERWRITES whatever (1) produced. It is the one that actually applies in
 *      a configured deployment, and it is the easiest to forget.
 *
 * (2) is exercised by running the real script against a throwaway manifest rather
 * than grepping its source, so the assertion is on the CSP a container would
 * actually serve.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const WEB_ROOT = path.join(__dirname, '..', '..');

const env = process.env as Record<string, string | undefined>;

interface HeaderEntry {
  key: string;
  value: string;
}
interface HeaderGroup {
  source: string;
  headers: HeaderEntry[];
}
interface NextConfigShape {
  headers: () => Promise<HeaderGroup[]>;
}

/** Re-reads next.config.js from scratch so the current env vars take effect. */
const readCsp = async (): Promise<string> => {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const config = require(path.join(WEB_ROOT, 'next.config.js')) as NextConfigShape;
  const groups = await config.headers();
  const header = groups
    .flatMap((g) => g.headers)
    .find((h) => h.key === 'Content-Security-Policy');
  if (!header) throw new Error('next.config.js emits no Content-Security-Policy header');
  return header.value;
};

const frameSrcOf = (csp: string): string => {
  const directive = csp.split('; ').find((d) => d.startsWith('frame-src '));
  if (!directive) throw new Error(`No frame-src directive in CSP: ${csp}`);
  return directive;
};

describe('next.config.js frame-src', () => {
  const saved = {
    NODE_ENV: env.NODE_ENV,
    NEXT_PUBLIC_CSP_FRAME_SRC: env.NEXT_PUBLIC_CSP_FRAME_SRC,
  };

  afterEach(() => {
    env.NODE_ENV = saved.NODE_ENV;
    env.NEXT_PUBLIC_CSP_FRAME_SRC = saved.NEXT_PUBLIC_CSP_FRAME_SRC;
    jest.resetModules();
  });

  it('allows blob: by default (production build, no override)', async () => {
    env.NODE_ENV = 'production';
    delete env.NEXT_PUBLIC_CSP_FRAME_SRC;

    expect(frameSrcOf(await readCsp())).toContain('blob:');
  });

  it('allows blob: in development', async () => {
    env.NODE_ENV = 'development';
    delete env.NEXT_PUBLIC_CSP_FRAME_SRC;

    expect(frameSrcOf(await readCsp())).toContain('blob:');
  });

  it('keeps blob: when NEXT_PUBLIC_CSP_FRAME_SRC adds origins', async () => {
    env.NODE_ENV = 'production';
    env.NEXT_PUBLIC_CSP_FRAME_SRC = 'https://grafana.example.com';

    const frameSrc = frameSrcOf(await readCsp());
    expect(frameSrc).toContain('blob:');
    expect(frameSrc).toContain('https://grafana.example.com');
  });

  it('still allows blob: images, which the report HTML relies on', async () => {
    env.NODE_ENV = 'production';
    delete env.NEXT_PUBLIC_CSP_FRAME_SRC;

    const csp = await readCsp();
    expect(csp.split('; ').find((d) => d.startsWith('img-src '))).toContain('blob:');
  });
});

describe('scripts/start-server.js runtime CSP patch', () => {
  let tmpDir: string;

  // The fixture is the CSP next.config.js really bakes in, not a hand-written
  // constant — so the "patcher must not strip blob:" cases below are testing the
  // production string, and a regression in either producer surfaces here.
  let BUILT_CSP: string;

  beforeAll(async () => {
    const savedNodeEnv = env.NODE_ENV;
    const savedFrameSrc = env.NEXT_PUBLIC_CSP_FRAME_SRC;
    env.NODE_ENV = 'production';
    delete env.NEXT_PUBLIC_CSP_FRAME_SRC;
    BUILT_CSP = await readCsp();
    env.NODE_ENV = savedNodeEnv;
    env.NEXT_PUBLIC_CSP_FRAME_SRC = savedFrameSrc;
  });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perfana-csp-'));
    fs.mkdirSync(path.join(tmpDir, '.next'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.next', 'routes-manifest.json'),
      JSON.stringify({
        headers: [
          {
            source: '/:path*',
            headers: [{ key: 'Content-Security-Policy', value: BUILT_CSP }],
          },
        ],
      }),
      'utf8',
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /**
   * Runs the real startup script against tmpDir. There is no `next` binary to be
   * found from a temp directory, so the script patches the manifest and then
   * exits non-zero instead of spawning a server — which is exactly the slice we
   * want, and why the non-zero status is ignored here.
   */
  const runStartServer = (extraEnv: Record<string, string>) => {
    try {
      execFileSync(process.execPath, [path.join(WEB_ROOT, 'scripts', 'start-server.js')], {
        cwd: tmpDir,
        env: { ...process.env, ...extraEnv },
        stdio: 'ignore',
        timeout: 20000,
      });
    } catch {
      // Expected: exit(1) once it cannot find the next binary.
    }
    const manifest = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.next', 'routes-manifest.json'), 'utf8'),
    );
    const header = manifest.headers[0].headers.find(
      (h: { key: string }) => h.key === 'Content-Security-Policy',
    );
    return header.value as string;
  };

  it('keeps blob: in the rewritten frame-src', () => {
    const csp = runStartServer({ NEXT_PUBLIC_CSP_FRAME_SRC: 'https://grafana.example.com' });

    const frameSrc = frameSrcOf(csp);
    expect(frameSrc).toContain('blob:');
    expect(frameSrc).toContain('https://grafana.example.com');
  });

  it('leaves the built-in blob: intact when there is nothing to patch', () => {
    // No NEXT_PUBLIC_CSP_FRAME_SRC and no NEXT_PUBLIC_API_URL — the patcher skips
    // entirely, so what next.config.js baked in must already be serviceable.
    const csp = runStartServer({
      NEXT_PUBLIC_CSP_FRAME_SRC: '',
      NEXT_PUBLIC_API_URL: '',
    });

    expect(frameSrcOf(csp)).toContain('blob:');
  });

  it('keeps blob: when only the API URL triggers a patch', () => {
    // connect-src is rewritten and the CSP string is reassembled from the parsed
    // directive map; frame-src must survive that round trip with blob: intact.
    const csp = runStartServer({
      NEXT_PUBLIC_CSP_FRAME_SRC: '',
      NEXT_PUBLIC_API_URL: 'https://api.example.com',
    });

    expect(frameSrcOf(csp)).toContain('blob:');
    expect(csp).toContain('https://api.example.com');
  });
});
