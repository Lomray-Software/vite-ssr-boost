import fs from 'node:fs';
import path from 'node:path';
import type { ResolvedConfig } from 'vite';

const markerFileName = 'server/.dev';

/**
 * Create dev marker
 *
 * @see printServerInfo
 */
const createDevMarker = (isProd: boolean, { root, build: buildConf }: ResolvedConfig): void => {
  const devMarkerPath = path.resolve(root, buildConf.outDir);
  const devMarker = `${devMarkerPath}/${markerFileName}`;

  if (!isProd) {
    if (!fs.existsSync(devMarkerPath)) {
      fs.mkdirSync(devMarkerPath, { recursive: true });
    }

    fs.writeFileSync(devMarker, '');
  } else if (fs.existsSync(devMarker)) {
    fs.rmSync(devMarker);
  }
};

export { createDevMarker, markerFileName };
