import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

/**
 * Allow serving overhead as a multiple of the same-run plain baseline, so the budget
 * holds on slower CI runners where absolute deltas grow with the hardware.
 */
const COLD_START_RATIO = 2;

/**
 * Compare resident bytes as a multiple of the plain baseline, without rounding to MiB.
 */
const RSS_RATIO = 1.6;

/**
 * Allow eight MiB of retained heap growth beyond the plain baseline after sustained load;
 * resident memory is reported but not budgeted because V8 keeps freed pages resident.
 */
const RETAINED_GROWTH_ALLOWANCE = 8 * 1024 ** 2;

/**
 * Compare the middle sample without rounding away budget failures.
 */
const median = (samples) => [...samples].sort((left, right) => left - right)[Math.floor(samples.length / 2)];

/**
 * Install npm launchers only in the disposable template copy.
 */
const configureProductionMeasurements = async (directory) => {
  const filename = join(directory, 'package.json');
  const metadata = JSON.parse(await readFile(filename, 'utf8'));

  await cp(join(import.meta.dirname, 'production-baseline.mjs'), join(directory, 'acceptance-baseline.mjs'));
  metadata.scripts.start = 'ssr-boost start';
  metadata.scripts['acceptance:baseline'] = 'node acceptance-baseline.mjs';
  await writeFile(filename, `${JSON.stringify(metadata, null, 2)}\n`);
};

/**
 * Collect the listening process's memory without changing the launcher's behavior.
 */
const createProductionMemoryProbe = async (port) => {
  const measurementDir = await mkdtemp(join(tmpdir(), 'ssr-boost-production-'));
  const pidFile = join(measurementDir, 'pid.json');
  const memoryFile = join(measurementDir, 'memory.json');
  const hook = join(import.meta.dirname, 'production-memory.cjs');

  /**
   * Read RSS immediately after the caller's TTFB run, without collecting npm's heap.
   */
  const memory = async () => {
    const { pid } = JSON.parse(await readFile(pidFile, 'utf8'));

    await rm(memoryFile, { force: true });
    process.kill(pid, 'SIGUSR2');

    for (let attempt = 0; attempt < 500; attempt += 1) {
      try {
        const sample = JSON.parse(await readFile(memoryFile, 'utf8'));

        assert.equal(sample.pid, pid, 'Production memory PID mismatch.');

        return sample;
      } catch (error) {
        if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      }

      await delay(10);
    }

    throw new Error('Production memory sample timed out.');
  };

  return {
    memory,
    environment: {
      SSR_BOOST_ACCEPTANCE_PORT: String(port),
      SSR_BOOST_ACCEPTANCE_PID: pidFile,
      SSR_BOOST_ACCEPTANCE_MEMORY: memoryFile,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --expose-gc --require ${JSON.stringify(hook)}`,
    },

    /** Remove the private PID and memory samples after the server stops. */
    dispose: () => rm(measurementDir, { recursive: true, force: true }),
  };
};

/**
 * Launch npm and track its process group plus the actual listening server PID.
 */
const startProductionMeasurement = async ({ directory, port, baseline = false, env = {} }) => {
  const { environment: probeEnvironment, memory, dispose } = await createProductionMemoryProbe(port);
  const environment = {
    ...process.env,
    ...env,
    NODE_ENV: 'production',
    ...probeEnvironment,
  };

  delete environment.NO_COLOR;

  const started = performance.now();
  const child = spawn('npm', ['run', baseline ? 'acceptance:baseline' : 'start', ...(baseline ? [] : ['--', '--port', String(port)])], {
    cwd: directory,
    env: environment,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const closed = once(child, 'close');

  /** Keep spawn failures available to the readiness error path. */
  closed.catch(() => {});
  let output = '';
  let spawnError;

  /**
   * Preserve diagnostics for readiness failures and the template summary.
   */
  const capture = (chunk) => { output += chunk; };

  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  child.once('error', (error) => { spawnError = error; });

  /**
   * Signal only the process group created by this measurement.
   */
  const signalGroup = (signal) => {
    if (!child.pid) {
      return;
    }

    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };

  /**
   * Reap npm and its server, including failed and timed-out starts.
   */
  const stop = async () => {
    signalGroup('SIGTERM');
    await Promise.race([closed.catch(() => {}), delay(3_000)]);
    signalGroup('SIGKILL');
    await closed.catch(() => {});
    await dispose();

    return output;
  };

  const origin = `http://127.0.0.1:${port}`;

  try {
    while (performance.now() - started < 30_000) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Production server exited: ${output}`);

      try {
        const response = await fetch(origin, { signal: AbortSignal.timeout(500) });

        await response.arrayBuffer();

        if (response.status === 200) {
          return { origin, coldStartMs: performance.now() - started, memory, stop };
        }
      } catch (error) {
        if (!(error instanceof TypeError) && !['TimeoutError', 'AbortError'].includes(error.name)) throw error;
      }

      await delay(25);
    }

    throw new Error(`Production server did not return HTTP 200: ${output}`);
  } catch (error) {
    await stop();

    throw error;
  }
};

/**
 * Alternate five fresh candidate and plain processes to reduce order-dependent drift.
 */
const measureProductionColdStart = async ({ directory, getPort }) => {
  const candidate = [];
  const baseline = [];

  for (let sample = 0; sample < 5; sample += 1) {
    for (const isBaseline of sample % 2 === 0 ? [true, false] : [false, true]) {
      const server = await startProductionMeasurement({ directory, port: await getPort(), baseline: isBaseline });

      try {
        (isBaseline ? baseline : candidate).push(server.coldStartMs);
      } finally {
        await server.stop();
      }
    }
  }

  return { candidateMs: median(candidate), baselineMs: median(baseline), candidate, baseline };
};

/**
 * Fail independently on startup latency and resident memory overhead.
 */
const assertProductionBudgets = ({
  coldStart,
  baselineRss,
  candidateRss,
  baselineRetained,
  candidateRetained,
  baselineLoadRetained,
  candidateLoadRetained,
}) => {
  const { candidateMs, baselineMs } = coldStart;

  assert.ok(candidateMs <= baselineMs * COLD_START_RATIO,
    `Production cold start ${candidateMs.toFixed(1)} ms exceeds ${COLD_START_RATIO} × plain baseline ${baselineMs.toFixed(1)} ms.`);
  assert.ok(candidateRss <= baselineRss * RSS_RATIO,
    `Production RSS ${(candidateRss / 1024 ** 2).toFixed(2)} MiB exceeds ${RSS_RATIO} × plain baseline ${(baselineRss / 1024 ** 2).toFixed(2)} MiB.`);

  const baselineGrowth = baselineLoadRetained - baselineRetained;
  const candidateGrowth = candidateLoadRetained - candidateRetained;

  assert.ok(Number.isFinite(baselineGrowth) && Number.isFinite(candidateGrowth), 'Retained heap samples are missing.');
  assert.ok(candidateGrowth <= baselineGrowth + RETAINED_GROWTH_ALLOWANCE,
    `Production retained heap growth after 10,000 additional requests ${(candidateGrowth / 1024 ** 2).toFixed(2)} MiB exceeds plain baseline growth ${(baselineGrowth / 1024 ** 2).toFixed(2)} MiB + 8 MiB.`);
};

export { createProductionMemoryProbe, configureProductionMeasurements, startProductionMeasurement, measureProductionColdStart, assertProductionBudgets };
