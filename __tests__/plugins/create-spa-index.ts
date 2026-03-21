import { describe, expect, it, vi } from 'vitest';
import ViteCreateSPAIndexPlugin from '@plugins/create-spa-index';

vi.mock('@plugins/handle-custom-entrypoint', () => ({
  getCurrentEntrypointName: vi.fn(),
}));

describe('ViteCreateSPAIndexPlugin', () => {
  it('should apply only for non-ssr build without custom entrypoint', async () => {
    const { getCurrentEntrypointName } = await import('@plugins/handle-custom-entrypoint');
    vi.mocked(getCurrentEntrypointName).mockReturnValue(undefined);

    const plugin = ViteCreateSPAIndexPlugin();

    expect(getApplyHook(plugin)({}, { command: 'build', isSsrBuild: false })).toBe(true);
    expect(getApplyHook(plugin)({}, { command: 'serve', isSsrBuild: false })).toBe(false);
    expect(getApplyHook(plugin)({}, { command: 'build', isSsrBuild: true })).toBe(false);
  });

  it('should disable plugin when custom entrypoint exists', async () => {
    const { getCurrentEntrypointName } = await import('@plugins/handle-custom-entrypoint');
    vi.mocked(getCurrentEntrypointName).mockReturnValue('custom');

    const plugin = ViteCreateSPAIndexPlugin();

    expect(getApplyHook(plugin)({}, { command: 'build', isSsrBuild: false })).toBe(false);
  });

  it('should emit modified spa html asset', () => {
    const emitFile = vi.fn();
    const plugin = ViteCreateSPAIndexPlugin({ filename: 'custom-spa.html', rootId: 'app' });
    const html = '<div id="app"></div>';

    expect(getTransformIndexHtmlHook(plugin)(html)).toBe(html);

    getGenerateBundleHook(plugin).call({ emitFile } as never);

    expect(emitFile).toHaveBeenCalledWith({
      type: 'asset',
      fileName: 'custom-spa.html',
      source: '<div id="app" data-force-spa="1"></div>',
    });
  });

  it('should skip emitting when transform was not called', () => {
    const emitFile = vi.fn();
    const plugin = ViteCreateSPAIndexPlugin();

    getGenerateBundleHook(plugin).call({ emitFile } as never);

    expect(emitFile).not.toHaveBeenCalled();
  });
});
const getApplyHook = (plugin: ReturnType<typeof ViteCreateSPAIndexPlugin>) => plugin.apply as any;
const getTransformIndexHtmlHook = (plugin: ReturnType<typeof ViteCreateSPAIndexPlugin>) =>
  (typeof plugin.transformIndexHtml === 'function'
    ? plugin.transformIndexHtml
    : plugin.transformIndexHtml?.handler) as any;
const getGenerateBundleHook = (plugin: ReturnType<typeof ViteCreateSPAIndexPlugin>) =>
  (typeof plugin.generateBundle === 'function'
    ? plugin.generateBundle
    : plugin.generateBundle?.handler) as any;
