// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import React from 'react';
import { expect, it } from 'vitest';
import testKit from '@__helpers__/testing-kit';
import { createTestHandler } from '../../src/testing';

testKit('node', createTestHandler);

it('uses loadHtmlShell for a real index.html and validates its outlet', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ssr-test-shell-'));
  const indexFile = join(directory, 'index.html');
  try {
    await writeFile(
      indexFile,
      '<html><body><div id="app"><!--ssr-outlet--></div><script type="module" src="/client.js"></script></body></html>',
    );
    const routes = [{ path: '/', element: <p>Real shell</p> }];
    const app = createTestHandler({ routes, shell: { indexFile } });
    expect(await (await app.fetch('/')).html()).toContain('id="app"');
    expect(await (await app.fetch('/')).html()).toContain('src="/client.js"');
    await writeFile(indexFile, '<html>No outlet</html>');
    await expect(
      createTestHandler({ routes, shell: { indexFile } }).fetch('/'),
    ).rejects.toThrow('SSR_BOOST_OUTLET_MISSING');
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
