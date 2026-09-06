import { bootWorkerFixture, createWorkerFixture } from './helpers/worker-fixture.mjs';

const fixture = await createWorkerFixture();
let runtime;
const stop = async () => {
  await runtime?.dispose();
  await fixture.dispose();
};
try {
  ({ runtime } = await bootWorkerFixture(fixture, 4180));
  console.info(`Worker browser fixture ready: ${await runtime.ready}`);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => void stop().then(() => process.exit(0)));
  }
} catch (error) {
  await stop();
  throw error;
}
