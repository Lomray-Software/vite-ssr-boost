import assert from 'node:assert/strict';
import { bootWorkerFixture, createWorkerFixture } from './helpers/worker-fixture.mjs';

const fixture = await createWorkerFixture({ keep: process.env.SSR_BOOST_KEEP_WORKER === '1' });
let runtime;
try {
  const booted = await bootWorkerFixture(fixture);
  runtime = booted.runtime;
  const origin = String(await runtime.ready);
  const request = (path, init = {}) =>
    fetch(new URL(path, origin), { redirect: 'manual', ...init });
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      const response = await request('/');
      assert.equal(response.status, 200);
      assert.match(await response.text(), /Worker home/);
    }),
  );
  console.info('PASS concurrent cold requests share the HTML shell safely');
  for (const [path, status, content] of [
    ['/', 200, 'Worker home'],
    ['/index.html', 404, 'Missing page'],
    ['/about', 200, 'Lazy Worker route'],
    ['/missing', 404, 'Missing page'],
  ]) {
    const response = await request(path);
    const html = await response.text();
    assert.equal(response.status, status, path);
    assert.ok(html.includes(content), path);
    assert.match(html, /window\.__staticRouterHydrationData/);
    assert.match(
      html,
      /<script\b[^>]*async[^>]*type="module"/,
      'Early hydration requires an async browser entry',
    );
    assert.equal(response.headers.get('X-Worker-Hook'), 'ready');
    if (path === '/about') {
      const style = fixture.manifest.about.find((asset) => asset.type === 'style').url;
      assert.ok(html.includes(`<link rel="stylesheet" href="${style}">`));
    }
  }
  console.info(
    'PASS / SSR + hydration state; /about lazy CSS; /missing 404; /index.html never leaks the raw shell',
  );
  const redirect = await request('/redirect');
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.get('Location'), '/about');
  assert.match(redirect.headers.get('Set-Cookie'), /visits=1/);
  await redirect.arrayBuffer();
  const cookie = await request('/cookie');
  const setCookie = cookie.headers.get('Set-Cookie').split(';')[0];
  assert.match(await cookie.text(), /visits.*1/);
  const roundTrip = await request('/cookie', { headers: { Cookie: setCookie } });
  assert.equal(roundTrip.status, 200);
  assert.match(await roundTrip.text(), /visits.*2/);
  assert.match(roundTrip.headers.get('Set-Cookie'), /visits=2/);
  console.info('PASS /redirect 301 and onRequest cookie round trip');
  const bindings = await request('/bindings');
  assert.equal(bindings.status, 200);
  assert.match(await bindings.text(), /Hello from KV/);
  for (let attempt = 0; attempt < 30 && (await booted.kv.get('background')) !== 'done'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(await booted.kv.get('background'), 'done');
  console.info('PASS loader KV read, executionContext in hooks and bound waitUntil KV write');
  const streamed = await request('/deferred');
  assert.equal(streamed.status, 200);
  const reader = streamed.body.getReader();
  const decoder = new TextDecoder();
  let html = '';
  let chunks = 0;
  let sawPending = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks += 1;
    html += decoder.decode(value, { stream: true });
    if (html.includes('data-fallback') && !html.includes('Resolved in workerd')) sawPending = true;
  }
  html += decoder.decode();
  assert.ok(sawPending, 'Must receive pending shell before resolved HTML');
  assert.ok(chunks > 1);
  assert.match(html, /\["resolve"/);
  assert.match(html, /data-resolved/);
  assert.ok(
    html.indexOf('["resolve"') < html.indexOf('<p data-resolved'),
    'Data frames precede resolved HTML',
  );
  assert.match(html, /Resolved in workerd/);
  assert.match(html, /<\/html>/);
  const bot = await request('/deferred', { headers: { 'User-Agent': 'Googlebot' } });
  const buffered = await bot.text();
  assert.equal(bot.status, 200);
  assert.doesNotMatch(buffered, /<!--\$\?-->/);
  assert.match(buffered, /Resolved in workerd/);
  console.info(
    `PASS /deferred streamed shell, data frames then resolved HTML (${chunks} chunks); Googlebot has zero pending boundaries`,
  );
  const assets = fixture.manifest.about.filter((asset) => ['style', 'script'].includes(asset.type));
  for (const asset of assets) {
    const response = await request(asset.url);
    assert.equal(response.status, 200, asset.url);
    assert.equal(response.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
    const etag = response.headers.get('ETag');
    await response.arrayBuffer();
    if (etag) {
      const conditional = await request(asset.url, { headers: { 'If-None-Match': etag } });
      assert.equal(conditional.status, 304);
      assert.equal(conditional.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
    }
  }
  for (const path of ['/robots.txt', '/health', '/assets/plain.txt']) {
    const response = await request(path);
    assert.equal(response.status, 200);
    assert.ok(!response.headers.get('Cache-Control')?.includes('immutable'));
    assert.doesNotMatch(await response.text(), /window\.__staticRouterHydrationData/);
  }
  for (const path of ['/', '/about', assets[0].url]) {
    const response = await request(path, { method: 'HEAD' });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '');
  }
  console.info(
    'PASS hashed static assets immutable (including 304), public files, extensionless file and HEAD',
  );
  console.info('Packed Worker acceptance passed in workerd without nodejs_compat.');
} finally {
  await runtime?.dispose();
  await fixture.dispose();
}
