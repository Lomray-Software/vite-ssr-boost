import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const result = spawnSync(
  process.execPath,
  [join(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs'), 'run', '__tests__/integration/miniflare.ts'],
  {
    env: { ...process.env, SSR_BOOST_PACKED_EDGE: '1' },
    stdio: 'inherit',
  },
);

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  throw new Error(`Packed edge acceptance failed with code ${result.status ?? 'unknown'}.`);
}
