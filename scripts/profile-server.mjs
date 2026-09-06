import { Server } from 'node:http';

const emit = Server.prototype.emit;
let started;
let requests = 0;

/** Exit normally so --cpu-prof writes its profile after the client finishes. */
process.once('SIGTERM', () => process.exit(0));

/** Put an identifiable window boundary in V8's clock domain. */
const startProfileWindow = () => {
  const end = performance.now() + 3;
  while (performance.now() < end) {}
};

/** Keep the closing marker outside the measured CPU interval. */
const endProfileWindow = () => {
  const end = performance.now() + 3;
  while (performance.now() < end) {}
};

/** Measure an isolated production server between the profiler client's control requests. */
Server.prototype.emit = function (event, ...args) {
  if (event === 'request') {
    const [request, response] = args;
    const command = request.headers['x-ssr-profile'];

    if (command === 'start' || command === 'end') {
      if (command === 'start') startProfileWindow();
      const cpu = process.cpuUsage();
      const thread = process.threadCpuUsage?.();
      const threadCpu = thread ? thread.user + thread.system : undefined;
      const at = Number(process.hrtime.bigint() / 1000n);
      const result = command === 'end' && started
        ? { start: started.at, end: at, requests, cpuUs: cpu.user + cpu.system - started.cpu, ...(threadCpu === undefined || started.threadCpu === undefined ? {} : { mainThreadCpuUs: threadCpu - started.threadCpu }) }
        : { start: at };

      started = { at, cpu: cpu.user + cpu.system, threadCpu };
      requests = 0;
      if (command === 'end') endProfileWindow();
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(result));

      return true;
    }

    requests += 1;
  }

  return emit.call(this, event, ...args);
};
