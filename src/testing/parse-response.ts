import { parse as decode } from 'devalue';
import { parse } from 'parse5';
import type { DefaultTreeAdapterTypes } from 'parse5';

type TStreamFrame = ['init', string, boolean] | ['resolve' | 'reject', number, string] | ['shell'];

interface IRouterState {
  loaderData: Record<string, any>;
  actionData: Record<string, any> | null;
  errors: Record<string, any> | null;
}

/** Parse only actual inline script nodes; never execute application JavaScript. */
const scripts = (html: string): string[] => {
  const result: string[] = [];

  /**
   * Collect script text while traversing parsed document nodes.
   */
  const visit = (node: DefaultTreeAdapterTypes.Node): void => {
    if ('tagName' in node && node.tagName === 'script') {
      result.push(node.childNodes.map((child) => ('value' in child ? child.value : '')).join(''));
    } else if ('childNodes' in node) {
      node.childNodes.forEach(visit);
    }
  };

  visit(parse(html));

  return result;
};

/** Frames contain only primitive tuple fields; encoded values are JSON strings. */
const streamFrames = (html: string): TStreamFrame[] => {
  const frames: TStreamFrame[] = [];

  for (const source of scripts(html)) {
    const pattern =
      /\(window\.__ssrBoostStream\s*=\s*window\.__ssrBoostStream\s*\|\|\s*\[\]\)\.push\((\[(?:"(?:\\.|[^"\\])*"|[^\]"\\])*\])\)/g;

    for (const match of source.matchAll(pattern)) {
      const frame: unknown = JSON.parse(match[1]);

      if (
        !Array.isArray(frame) ||
        !(
          (frame[0] === 'shell' && frame.length === 1) ||
          (frame[0] === 'init' &&
            frame.length === 3 &&
            typeof frame[1] === 'string' &&
            typeof frame[2] === 'boolean') ||
          (['resolve', 'reject'].includes(frame[0] as string) &&
            frame.length === 3 &&
            Number.isInteger(frame[1]) &&
            typeof frame[2] === 'string')
        )
      ) {
        throw new Error('Invalid SSR Boost stream frame.');
      }

      frames.push(frame as TStreamFrame);
    }
  }

  return frames;
};

/** Distinguish transport placeholders from application objects containing an id. */
class Placeholder {
  /**
   * Preserve the streamed promise identity until its settlement is decoded.
   */
  public constructor(
    /**
     * Link this placeholder to its stream settlement.
     */
    public readonly id: number,
  ) {}
}

/** Decode the same value vocabulary as the browser receiver, without a DOM or eval. */
const value = (payload: string): unknown =>
  decode(payload, {
    /**
     * Retain promise references until their settlements can be resolved.
     */
    SSRBPromise: ([id]: [number]) => new Placeholder(id),

    /**
     * Restore own application object entries.
     */
    SSRBObject: (entries: [string, unknown][]) => Object.fromEntries(entries),

    /**
     * Restore rejection properties without inventing a server stack.
     */
    SSRBError: (entries: [string, unknown][]) => {
      const properties = Object.fromEntries(entries);
      const error = Object.assign(new Error('Streamed loader/action rejection'), properties);

      if (!properties.stack) {
        delete error.stack;
      }

      return error;
    },

    /**
     * Restore explicit undefined values from the transport vocabulary.
     */
    SSRBUndefined: () => undefined,
  });

/** Resolve nested identities and preserve native collections, holes and own keys. */
const routerState = (html: string): IRouterState | undefined => {
  const frames = streamFrames(html);
  const initial = frames.filter((frame) => frame[0] === 'init');

  if (!initial.length) {
    for (const source of scripts(html)) {
      const legacy = source.match(
        /window\.__staticRouterHydrationData\s*=\s*JSON\.parse\(("(?:\\.|[^"\\])*")\)/,
      );

      if (legacy) {
        return JSON.parse(JSON.parse(legacy[1]) as string) as IRouterState;
      }
    }

    return undefined;
  }

  if (initial.length !== 1) {
    throw new Error('Expected exactly one SSR Boost init frame.');
  }

  const settlements = new Map<number, unknown>();
  const rejected = new Set<number>();

  for (const frame of frames) {
    if (frame[0] === 'resolve' || frame[0] === 'reject') {
      if (settlements.has(frame[1])) {
        throw new Error(`Duplicate settlement for SSR promise ${frame[1]}.`);
      }

      settlements.set(frame[1], value(frame[2]));

      if (frame[0] === 'reject') {
        rejected.add(frame[1]);
      }
    }
  }

  const visited = new WeakSet<object>();
  const resolving = new Set<number>();
  const resolved = new Map<number, unknown>();

  /**
   * Replace placeholders recursively while preserving shared and circular values.
   */
  const resolve = (item: unknown): unknown => {
    if (item instanceof Placeholder) {
      const { id } = item;

      if (!settlements.has(id)) {
        throw new Error(`Missing settlement for SSR promise ${id}.`);
      }

      if (rejected.has(id)) {
        throw settlements.get(id);
      }

      if (resolving.has(id)) {
        throw new Error(`Circular SSR promise ${id}.`);
      }

      if (!resolved.has(id)) {
        resolving.add(id);
        resolved.set(id, resolve(settlements.get(id)));
        resolving.delete(id);
      }

      return resolved.get(id);
    }

    if (!item || typeof item !== 'object' || visited.has(item)) {
      return item;
    }

    visited.add(item);

    if (item instanceof Map) {
      const entries = [...(item as Map<unknown, unknown>)];

      item.clear();

      /**
       * Resolve both keys and values while retaining the original map identity.
       */
      entries.forEach(([key, child]) => item.set(resolve(key), resolve(child)));
    } else if (item instanceof Set) {
      const entries = [...(item as Set<unknown>)];

      item.clear();

      /**
       * Resolve members while retaining the original set identity.
       */
      entries.forEach((child) => item.add(resolve(child)));
    } else {
      for (const key of Object.keys(item)) {
        Object.defineProperty(item, key, {
          configurable: true,
          enumerable: true,
          writable: true,
          value: resolve(Reflect.get(item, key)),
        });
      }
    }

    return item;
  };

  return resolve(value(initial[0][1])) as IRouterState;
};

export { routerState, streamFrames };

export type { IRouterState, TStreamFrame };
