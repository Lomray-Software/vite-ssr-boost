// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import type { ViteDevServer } from 'vite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import runDev from '@cli/run-dev';
import PLUGIN_NAME from '@constants/plugin-name';

const { createServerMock, createDevServerMock } = vi.hoisted(() => ({
  createServerMock: vi.fn(),
  createDevServerMock: vi.fn(),
}));

vi.mock('@adapters/express/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@adapters/express/server')>()),
  default: createServerMock,
}));
vi.mock('@node/dev', () => ({ createDevServer: createDevServerMock }));

const originalCwd = process.cwd();
let root: string;
let started: ViteDevServer[];

/**
 * Write a Vite config that records every evaluation and carries the given boost options.
 */
const writeProject = (pluginOptions: Record<string, unknown>): void => {
  writeFileSync(
    path.join(root, 'vite.config.mjs'),
    `import { appendFileSync } from 'node:fs';

appendFileSync(${JSON.stringify(path.join(root, 'evaluations.log'))}, 'x');

export default {
  logLevel: 'silent',
  server: { hmr: false },
  plugins: [
    { name: ${JSON.stringify(PLUGIN_NAME)}, pluginOptions: ${JSON.stringify(pluginOptions)} },
  ],
};
`,
  );
};

/**
 * How many times the project's Vite config was evaluated.
 */
const evaluations = (): number =>
  readFileSync(path.join(root, 'evaluations.log'), 'utf8').length;

beforeEach(() => {
  root = mkdtempSync(path.resolve('.ssr-boost-dev-test-'));
  started = [];
  process.chdir(root);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await Promise.all(started.map((vite) => vite.close()));
  rmSync(root, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('ssr-boost dev config evaluation', { timeout: 30000 }, () => {
  it('should evaluate the config once for the default Express dev server', async () => {
    const server = Object.assign(new EventEmitter(), { id: 'express' });

    writeProject({});
    createServerMock.mockImplementation((config: { getVite: () => ViteDevServer }) => {
      started.push(config.getVite());

      return Promise.resolve({ run: () => server, getLifecycle: () => undefined });
    });

    expect((await runDev({ version: '1', isPrintInfo: false, mode: 'development' })).server).toBe(
      server,
    );
    expect(createServerMock).toHaveBeenCalledTimes(1);
    expect(started[0].config.root).toBe(root);
    expect(evaluations()).toBe(1);
  });

  it('should close the picking Vite before the node server starts', async () => {
    writeProject({ managedServer: 'node' });
    createDevServerMock.mockImplementation(() => {
      // The picking Vite ran once and is gone by the time the node server starts.
      expect(evaluations()).toBe(1);

      return Promise.reject(new Error('node server started'));
    });

    await expect(runDev({ version: '1', isPrintInfo: false, mode: 'development' })).rejects.toThrow(
      'node server started',
    );
    expect(createServerMock).not.toHaveBeenCalled();
    expect(createDevServerMock).toHaveBeenCalledTimes(1);
  });
});
