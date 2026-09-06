// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import testInit, { assertNodeEngines } from '../../scripts/test-init.mjs';

it('migrates a stock React TS app and serves every parser fixture with lazy CSS from the packed library', async () => {
  await testInit();
}, 240_000);

it('explains an unsupported Node runtime before running the end-to-end build', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ssr-boost-engine-test-'));
  try {
    const dependency = path.join(root, 'node_modules/react-router');
    fs.mkdirSync(dependency, { recursive: true });
    fs.writeFileSync(
      path.join(dependency, 'package.json'),
      JSON.stringify({ name: 'react-router', engines: { node: '>=22.22.0' } }),
    );
    expect(() => assertNodeEngines(root, '22.21.0')).toThrow(
      /Stock-app end-to-end precondition failed: Node 22\.21\.0.*react-router: >=22\.22\.0.*Use Node 22\.23\.2/,
    );
    expect(() => assertNodeEngines(root, '22.23.2')).not.toThrow();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
