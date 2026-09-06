import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [profileFile, windowsFile] = process.argv.slice(2);
assert.ok(profileFile && windowsFile, 'Usage: node scripts/summarize-cpu.mjs profile.cpuprofile profile-stream.jsonl');
const profile = JSON.parse(await readFile(profileFile, 'utf8'));
const windows = (await readFile(windowsFile, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
const parents = new Map(profile.nodes.flatMap(({ id, children = [] }) => children.map((child) => [child, id])));
const categories = new Map();
const markers = [];
let sampleTime = profile.startTime;
let previousMarker;

/** Use sampled markers because V8 and Node can expose different monotonic clocks. */
for (let index = 0; index < profile.samples.length; index += 1) {
  sampleTime += profile.timeDeltas[index];
  let marker;
  for (let current = profile.samples[index]; current; current = parents.get(current)) {
    const { functionName } = nodes.get(current).callFrame;
    if (functionName === 'startProfileWindow' || functionName === 'endProfileWindow') marker = functionName;
  }
  if (marker && marker !== previousMarker) markers.push({ marker, at: sampleTime });
  if (marker) previousMarker = marker;
}

assert.equal(markers.length, windows.length * 2, 'Profile must contain start/end markers for every measured window.');

/** Attribute native work to its closest identifiable caller without double counting. */
const category = (id) => {
  if (categories.has(id)) return categories.get(id);
  const frames = [];
  for (let current = id; current; current = parents.get(current)) frames.push(nodes.get(current).callFrame);
  const leaf = frames[0];
  let result = 'Node / other';

  if (leaf.functionName === '(idle)') result = 'Idle';
  else if (leaf.functionName === '(garbage collector)') result = 'GC';
  else if (frames.some(({ url }) => /react-dom/.test(url))) result = 'React rendering';
  else {
    for (const { url, functionName } of frames) {
      if (/profile-server\.mjs/.test(url)) { result = 'Profiler control'; break; }
      if (/react-dom/.test(url)) { result = 'React rendering'; break; }
      if (/devalue|core\/data-stream|helpers\/(?:build-router-state|serialize-errors|try-json)/.test(url)) { result = 'Data / serialization'; break; }
      if (/core\/(?:compose-html|transform-html|html-boundary)/.test(url)) { result = 'HTML chunk pipeline'; break; }
      if (/route-assets|ssr-manifest/.test(url)) { result = 'Asset preparation'; break; }
      if (/core\/(?:spa-shell|spa-html|ssr-policy)|node_modules\/isbot\//.test(url)) { result = 'SPA / policy'; break; }
      if (/diagnostics|request-timeline/.test(url)) { result = 'Diagnostics / timeline'; break; }
      if (/core\/headers|node\/(?:create-headers|write-fetch-response)|internal\/deps\/undici/.test(url) && /[Hh]eader|headers/.test(functionName + url)) { result = 'Headers'; break; }
      if (/node_modules\/(?:serve-static|send)\//.test(url)) { result = 'Static middleware'; break; }
      if (/node_modules\/compression\/|node:zlib/.test(url)) { result = 'Compression'; break; }
      if (/cookie-parser|body-parser/.test(url)) { result = 'Cookie / body parsing'; break; }
      if (/react-router/.test(url)) { result = 'Router query / matching'; break; }
      if (/vite-ssr-boost\//.test(url)) { result = 'Other boost / bridge'; break; }
      if (/node_modules\/(?:express|router)\//.test(url)) { result = 'Express dispatch'; break; }
      if (/node:_http|node:net|internal\/stream_base_commons/.test(url)) { result = 'Node HTTP / socket'; break; }
    }
  }

  categories.set(id, result);

  return result;
};

/** Restrict samples to measured requests, excluding module loading and warm-up. */
for (const [windowIndex, window] of windows.entries()) {
  const start = markers[windowIndex * 2].at + 3000;
  const end = markers[windowIndex * 2 + 1].at;
  const stages = {};
  let at = profile.startTime;

  for (let index = 0; index < profile.samples.length; index += 1) {
    const elapsed = profile.timeDeltas[index];
    at += elapsed;
    if (at < start || at > end) continue;
    const stage = category(profile.samples[index]);
    stages[stage] = (stages[stage] ?? 0) + elapsed;
  }

  const perRequest = Object.fromEntries(Object.entries(stages).filter(([name]) => name !== 'Idle' && name !== 'Profiler control').map(([name, total]) => [name, Number((total / window.requests).toFixed(1))]));
  console.info(JSON.stringify({ pathname: window.pathname, encoding: window.encoding, requests: window.requests, sampledUsPerRequest: perRequest }));
}
