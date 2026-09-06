import { data, type StaticHandlerContext } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import receiveStream from '@browser/stream';
import DataStream from '@core/data-stream';
import { streamScript } from '@core/script';
import Diagnostics from '@services/diagnostics';

const context = (loaderData: unknown, actionData: unknown = null) =>
  ({ loaderData, actionData, errors: null }) as StaticHandlerContext;
const deferred = () => {
  let resolve!: (value: any) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
const runScripts = (html: string) => {
  for (const [, code] of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
    new Function('window', code)(window);
  }
};

afterEach(() => {
  Reflect.deleteProperty(window, '__ssrBoostStream');
  Reflect.deleteProperty(window, '__staticRouterHydrationData');
});

describe('loader/action stream codec', () => {
  it.each(['before', 'after'])(
    'restores stable placeholders when entry runs %s the scripts',
    async (entryTime) => {
      const slow = deferred();
      const stream = new DataStream(
        context(
          { root: slow.promise, nested: [{ slow: slow.promise }] },
          { root: { slow: slow.promise } },
        ),
      );
      const receiver = entryTime === 'before' ? receiveStream() : undefined;
      runScripts(await stream.state(false));
      const state = (await (receiver ?? receiveStream()).ready) as any;
      expect(state.loaderData.root).toBeInstanceOf(Promise);
      expect(state.loaderData.root).toBe(state.loaderData.nested[0].slow);
      expect(state.actionData.root.slow).toBe(state.loaderData.root);
      slow.resolve({ nested: Promise.resolve({ answer: 42 }) });
      await stream.done;
      runScripts(await stream.take());
      const result = await state.loaderData.root;
      expect(result.nested).toBeInstanceOf(Promise);
      expect(await result.nested).toEqual({ answer: 42 });
    },
  );

  it.each(['before', 'after'])(
    'restores settlements preceding footer initialization when entry runs %s the scripts',
    async (entryTime) => {
      const slow = deferred();
      const stream = new DataStream(context({ root: { slow: slow.promise } }));
      const receiver = entryTime === 'before' ? receiveStream() : undefined;
      slow.resolve({ nested: Promise.resolve({ answer: 42 }) });
      await stream.done;
      runScripts(stream.take());
      runScripts(stream.state(false));
      const state = (await (receiver ?? receiveStream()).ready) as any;
      expect(state.loaderData.root.slow).toBeInstanceOf(Promise);
      const result = await state.loaderData.root.slow;
      expect(result.nested).toBeInstanceOf(Promise);
      expect(await result.nested).toEqual({ answer: 42 });
    },
  );

  it('supports the same value matrix initially and inside settlements', async () => {
    const value = {
      json: { string: 'value', number: 3, boolean: true, null: null, array: [1, null] },
      date: new Date('2026-09-01'),
      map: new Map([[{ key: 1 }, ['value']]]),
      set: new Set([1, 'two']),
      missing: undefined,
      big: 9007199254740993n,
      regex: /<script>/gi,
    };
    const slow = deferred();
    const stream = new DataStream(
      context({ root: { value, slow: slow.promise } }, { root: { value } }),
    );
    runScripts(await stream.state(false));
    const state = (await receiveStream().ready) as any;
    expect(state.loaderData.root.value).toEqual(value);
    expect(state.actionData.root.value).toEqual(value);
    slow.resolve(value);
    await stream.done;
    runScripts(await stream.take());
    expect(await state.loaderData.root.slow).toEqual(value);
    expect(Object.hasOwn(state.loaderData.root.value, 'missing')).toBe(true);
  });

  it.each([
    [new TypeError('ordinary failure'), { message: 'ordinary failure', name: 'TypeError' }],
    [
      { status: 409, statusText: 'Conflict', data: { reason: 'duplicate' }, internal: false },
      { message: 'Conflict', status: 409, statusText: 'Conflict', data: { reason: 'duplicate' } },
    ],
    [
      data({ reason: 'invalid' }, { status: 422, statusText: 'Unprocessable' }),
      {
        message: 'Unprocessable',
        status: 422,
        statusText: 'Unprocessable',
        data: { reason: 'invalid' },
      },
    ],
  ])('preserves rejection details %# without stacks by default', async (error, expected) => {
    const slow = deferred();
    const stream = new DataStream(context({}, { root: { slow: slow.promise } }));
    runScripts(await stream.state(false));
    const state = (await receiveStream().ready) as any;
    slow.reject(error);
    await stream.done;
    runScripts(await stream.take());
    await expect(state.actionData.root.slow).rejects.toMatchObject(expected);
    expect(
      (await state.actionData.root.slow.catch((failure: unknown) => failure)).stack,
    ).toBeUndefined();
  });

  it('includes stacks only when diagnostics are enabled', async () => {
    const slow = deferred();
    const stream = new DataStream(context({ root: slow.promise }), new Diagnostics('/stack'));
    runScripts(await stream.state(false));
    const state = (await receiveStream().ready) as any;
    const error = new Error('with stack');
    slow.reject(error);
    await stream.done;
    runScripts(await stream.take());
    await expect(state.loaderData.root).rejects.toHaveProperty('stack', error.stack);
  });

  it('escapes script terminators, comments, separators, keys and nonce attributes', async () => {
    const attack = '</script><!--\u2028\u2029';
    const slow = deferred();
    const stream = new DataStream(
      context({ [attack]: { slow: slow.promise, attack } }),
      undefined,
      '\"<>&',
    );
    const initial = await stream.state(false);
    expect(initial.match(/<\/script>/g)).toHaveLength(2);
    expect(initial).not.toContain('<!--');
    expect(initial).not.toMatch(/[\u2028\u2029]/);
    expect(initial).toContain('nonce="&#34;&#60;&#62;&#38;"');
    runScripts(initial);
    const state = (await receiveStream().ready) as any;
    expect(state.loaderData[attack].attack).toBe(attack);
    slow.resolve({ attack });
    await stream.done;
    const settlement = await stream.take();
    expect(settlement.match(/<\/script>/g)).toHaveLength(1);
    expect(settlement).not.toContain('<!--');
    runScripts(settlement);
    expect(await state.loaderData[attack].slow).toEqual({ attack });
  });

  it('rejects pending promises on abort, ignores late settlements and emits one diagnostic', async () => {
    const slow = deferred();
    const warn = vi.fn();
    const stream = new DataStream(
      context({ root: slow.promise }),
      new Diagnostics('/abort-codec', { warn }),
    );
    runScripts(await stream.state(false));
    const state = (await receiveStream().ready) as any;
    stream.abort();
    stream.abort();
    await stream.done;
    runScripts(await stream.take());
    await expect(state.loaderData.root).rejects.toThrow('SSR loader/action promise aborted');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('SSR_BOOST_STREAM_PROMISE_ABORTED');
    slow.resolve('late');
    await Promise.resolve();
    expect(await stream.take()).toBe('');
  });

  it('waits for the parsed shell in early mode, including when shell arrives first', async () => {
    const stream = new DataStream(context({ root: { title: 'early' } }));
    const receiver = receiveStream();
    const ready = vi.fn();
    receiver.ready.then(ready);
    runScripts(await stream.state(true));
    await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();
    runScripts(streamScript(['shell']));
    await receiver.ready;
    expect(ready).toHaveBeenCalled();
  });

  it('keeps prototype-shaped user keys as own data properties', async () => {
    const value = JSON.parse('{"__proto__":{"polluted":true},"constructor":"safe"}');
    const stream = new DataStream(context({ root: value }));
    runScripts(await stream.state(false));
    const state = (await receiveStream().ready) as any;
    expect(state.loaderData.root).toEqual(value);
    expect(Object.getPrototypeOf(state.loaderData.root)).toBe(Object.prototype);
    expect(({} as any).polluted).toBeUndefined();
  });
});

describe('stream data diagnostics', () => {
  it('continues warning about unsupported functions, symbols, classes and cycles', async () => {
    class Model {
      value = 1;
    }
    const cycle: any = {};
    cycle.self = cycle;
    const warn = vi.fn();
    const stream = new DataStream(
      context({ root: { fn: () => 1, symbol: Symbol('x'), model: new Model(), cycle } }),
      new Diagnostics('/unsupported-codec', { warn }),
    );
    runScripts(stream.state(false));
    expect(warn).toHaveBeenCalledTimes(4);
    expect(
      warn.mock.calls.every(([message]) => message.includes('SSR_BOOST_LOADER_NOT_SERIALIZABLE')),
    ).toBe(true);
    const state = (await receiveStream().ready) as any;
    expect(state.loaderData.root.fn).toBeUndefined();
    expect(state.loaderData.root.cycle.self).toBe(state.loaderData.root.cycle);
  });
});
