import type { ViteDevServer } from 'vite';

/**
 * Create the Express dev Vite server: middleware mode, app type 'custom', polling watch.
 * The CLI picks the managed server from it without loading Express; not a public API.
 */
const createDevVite = async (mode: string): Promise<ViteDevServer> =>
  (await import('vite')).createServer({
    server: {
      middlewareMode: true,
      watch: {
        /**
         * During tests, we edit the files too fast and sometimes chokidar
         * misses change events, so enforce polling for consistency
         */
        usePolling: true,
        interval: 100,
      },
    },
    appType: 'custom',
    mode,
  });

export default createDevVite;
