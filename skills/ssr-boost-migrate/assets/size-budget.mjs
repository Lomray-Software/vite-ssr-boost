import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { gzipSync } from 'node:zlib';

const measure = process.argv[2] === '--measure';
const config = measure
  ? { assetsDir: process.argv[3] }
  : JSON.parse(await readFile(new URL('./size-budget.json', import.meta.url), 'utf8'));
assert.ok(config.assetsDir, 'Configure assetsDir or use --measure <assets-directory>.');
if (!measure) assert.ok(Number.isSafeInteger(config.maxGzipBytes) && config.maxGzipBytes > 0,
  'Configure a positive maxGzipBytes budget.');
const directory = resolve(config.assetsDir);
const files = (await readdir(directory, { recursive: true }))
  .filter((file) => /\.(?:js|mjs|cjs)$/.test(file)).sort();
assert.ok(files.length, 'No client JavaScript found; build the application first.');
let total = 0;
for (const file of files) {
  const bytes = gzipSync(await readFile(join(directory, file))).length;
  total += bytes;
  console.info(`${file}: ${bytes} gzip bytes`);
}
console.info(`Client JavaScript: ${total} gzip bytes${measure ? ' (measurement only)' : ` / ${config.maxGzipBytes} budget`}`);
if (!measure) assert.ok(total <= config.maxGzipBytes, 'Client JavaScript exceeds its size budget.');
