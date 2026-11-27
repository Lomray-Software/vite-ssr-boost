// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import createServeStatic from 'serve-static';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import serveStatic from '@node/serve-static';

vi.mock('serve-static', async (importOriginal) => {
  // serve-static is CommonJS, so its factory arrives as the default export.
  const actual = await importOriginal<{ default: typeof createServeStatic }>();

  return { default: vi.fn(actual.default) };
});

/**
 * Keys of every options object handed to serve-static whose own value is undefined.
 */
const getUndefinedKeys = (): string[] =>
  vi
    .mocked(createServeStatic)
    .mock.calls.flatMap(([, options]) =>
      Object.entries(options ?? {})
        .filter(([, value]) => value === undefined)
        .map(([key]) => key),
    );

describe('node serveStatic options passed to serve-static', () => {
  let root: string;

  beforeEach(async () => {
    vi.mocked(createServeStatic).mockClear();
    root = await mkdtemp(path.join(tmpdir(), 'ssr-serve-static-options-'));
    await writeFile(path.join(root, 'index.html'), 'document');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('passes no unset option to serve-static in SPA mode', () => {
    serveStatic({ root, isSPA: true });

    expect(createServeStatic).toHaveBeenCalled();
    expect(getUndefinedKeys()).toEqual([]);
  });

  it('passes no unset option to serve-static for an SSR build and keeps the index off', () => {
    serveStatic({ root });

    const calls = vi.mocked(createServeStatic).mock.calls;

    expect(calls.length).toBeGreaterThan(0);
    expect(getUndefinedKeys()).toEqual([]);
    expect(calls.every(([, options]) => options?.index === false)).toBe(true);
  });

  it('hands serve-static a copy of the extension list, never the caller array', () => {
    const extensions = ['html'];

    serveStatic({ root, extensions });

    const { calls } = vi.mocked(createServeStatic).mock;
    const passed = calls.map(([, options]) => options?.extensions);

    expect(passed[0]).toEqual(['html']);
    expect(passed.includes(extensions)).toBe(false);
  });
});
