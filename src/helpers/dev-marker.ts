import fs from 'node:fs';
import path from 'node:path';
import type { ResolvedConfig } from 'vite';

const getMarkerFile = (root: string, withFile = true): string =>
  [root, 'server', withFile && '.dev'].filter(Boolean).join('/');

/**
 * Create dev marker
 *
 * @see printServerInfo
 */
const createDevMarker = (isProd: boolean, { root, build: buildConf }: ResolvedConfig): void => {
  const buildRoot = path.resolve(root, buildConf.outDir);
  const devMarkerPath = getMarkerFile(buildRoot, false);
  const devMarker = getMarkerFile(buildRoot);

  if (!isProd) {
    if (!fs.existsSync(devMarkerPath)) {
      fs.mkdirSync(devMarkerPath, { recursive: true });
    }

    fs.writeFileSync(devMarker, '');
  } else if (fs.existsSync(devMarker)) {
    fs.rmSync(devMarker);
  }
};

export { createDevMarker, getMarkerFile };
