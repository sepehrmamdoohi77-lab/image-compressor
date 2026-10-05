// Reproducible headless QA without an external browser CDN. Not a game dependency.
import chromium from '@sparticuz/chromium';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const env = { ...process.env };
if (!env.ARENA_CHROMIUM_PATH) {
  env.ARENA_CHROMIUM_PATH = await chromium.executablePath();
  if (process.platform === 'linux') {
    const packageDir = path.resolve(path.dirname(require.resolve('@sparticuz/chromium')), '..');
    const dir = path.join(os.tmpdir(), 'ta-browser-libs');
    fs.mkdirSync(dir, { recursive: true });
    const archive = path.join(dir, 'libs.tar');
    fs.writeFileSync(
      archive,
      zlib.brotliDecompressSync(fs.readFileSync(path.join(packageDir, 'bin/al2023.tar.br'))),
    );
    const extract = spawnSync('tar', ['xf', archive, '-C', dir]);
    if (extract.status !== 0) throw new Error('Could not extract headless browser libraries.');
    env.LD_LIBRARY_PATH = `${path.join(dir, 'lib')}:/tmp${env.LD_LIBRARY_PATH ? ':' + env.LD_LIBRARY_PATH : ''}`;
  }
}
const cli = require.resolve('@playwright/test/cli');
const child = spawnSync(process.execPath, [cli, 'test', ...process.argv.slice(2)], {
  env,
  stdio: 'inherit',
});
process.exit(child.status ?? 1);
