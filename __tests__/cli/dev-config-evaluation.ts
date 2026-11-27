// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ownSignals from '@cli/helpers/own-signals';
import runDev from '@cli/run-dev';
import PLUGIN_NAME from '@constants/plugin-name';

const { createServerMock, createDevServerMock, picks, gate } = vi.hoisted(() => ({
  createServerMock: vi.fn(),
  createDevServerMock: vi.fn(),
  picks: [] as { close: () => Promise<void> }[],
  gate: { closing: Promise.resolve() },
}));

// The real adapter mounts the picking Vite; the spy only records how it was called.
vi.mock('@adapters/express/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@adapters/express/server')>();

  createServerMock.mockImplementation(actual.default);

  return { ...actual, default: createServerMock };
});
// Only the entry loading is replaced: the project has no entry to render.
vi.mock('@adapters/express/prepare-server', () => ({
  default: {
    init: () => ({
      onAppCreated: () => Promise.resolve(),
      getMiddlewaresConfig: () => ({}),
    }),
  },
}));
// Every Vite the CLI creates is recorded, and its close waits for the test's gate.
vi.mock('@cli/helpers/create-dev-vite', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cli/helpers/create-dev-vite')>();

  return {
    default: async (mode: string) => {
      const vite = await actual.default(mode);
      const close = vite.close.bind(vite);

      vite.close = vi.fn(async () => {
        await gate.closing;
        await close();
      });
      picks.push(vite);

      return vite;
    },
  };
});
vi.mock('@node/dev', () => ({ createDevServer: createDevServerMock }));

const originalCwd = process.cwd();
let root: string;

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
  server: { hmr: false, port: 0 },
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
  picks.length = 0;
  gate.closing = Promise.resolve();
  process.chdir(root);
});

afterEach(async () => {
  // Drop any signal subscription a started server took.
  ownSignals(undefined);
  process.chdir(originalCwd);
  await Promise.all(picks.map((vite) => vite.close()));
  rmSync(root, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('ssr-boost dev config evaluation', { timeout: 30000 }, () => {
  it('should mount the picking Vite in the real Express adapter without a second one', async () => {
    writeProject({});

    const { server, config, lifecycle } = await runDev({
      version: '1',
      isPrintInfo: false,
      mode: 'development',
    });

    try {
      await once(server, 'listening');

      expect(picks).toHaveLength(1);
      expect(createServerMock).toHaveBeenCalledExactlyOnceWith(config, {}, picks[0]);
      expect(config.getVite()).toBe(picks[0]);
      expect(config.getVite()!.config.root).toBe(root);
      expect(evaluations()).toBe(1);
    } finally {
      await lifecycle!.close();
    }

    expect(picks[0].close).toHaveBeenCalledOnce();
  });

  it('should start the node server only after the picking Vite closed', async () => {
    let release = (): void => undefined;

    writeProject({ managedServer: 'node' });
    gate.closing = new Promise((resolve) => {
      release = resolve;
    });
    createDevServerMock.mockRejectedValue(new Error('node server started'));

    const started = runDev({ version: '1', isPrintInfo: false, mode: 'development' });
    // Attach the rejection handler at once so a failure while the gate is held is not unhandled.
    const outcome = expect(started).rejects.toThrow('node server started');

    try {
      await vi.waitFor(() => expect(picks[0]?.close).toHaveBeenCalledOnce(), { timeout: 20000 });

      // The gate keeps close pending, so a start that awaits it cannot have gone further.
      expect(createDevServerMock).not.toHaveBeenCalled();
    } finally {
      release();
    }

    await outcome;
    expect(createServerMock).not.toHaveBeenCalled();
    expect(createDevServerMock).toHaveBeenCalledOnce();
    expect(evaluations()).toBe(1);
  });
});
