interface IBrowserTimelineEvent {
  stage: 'shell' | 'router.ready' | 'init' | 'resolve' | 'reject' | 'response.end';

  /** Monotonic milliseconds since the browser's time origin. */
  at: number;
  id?: number;
}

interface IBrowserObservation {
  events: IBrowserTimelineEvent[];
  errors: string[];
  roots: Record<string, string>;

  /** First visible observation of each element, in monotonic milliseconds. */
  seen: WeakMap<Element, number>;

  /** First visible shell observation, in monotonic milliseconds. */
  shellAt?: number;
}

interface IHydrationInspection {
  ready: boolean;
  consumed: boolean;
  pending: number;
  duplicates: string[];
  errors: string[];
}

declare global {
  /**
   * Browser global augmentation keeps the platform interface name.
   */
  // eslint-disable-next-line @typescript-eslint/naming-convention
  interface Window {
    __ssrBoostTest?: IBrowserObservation;
  }
}

/** Serialized by addInitScript: keep every runtime dependency inside this function. */
const installBrowserObserver = (): void => {
  if (window.__ssrBoostTest) {
    return;
  }

  const state: IBrowserObservation = {
    events: [],
    errors: [],
    roots: {},
    seen: new WeakMap(),
  };
  const { events, errors, roots, seen } = state;

  window.__ssrBoostTest = state;

  /**
   * Record browser milestones on the same monotonic clock.
   */
  const record = (stage: IBrowserTimelineEvent['stage'], id?: number): void => {
    events.push({ stage, at: performance.now(), ...(id === undefined ? {} : { id }) });
  };

  /**
   * Observe the first visible shell and the first appearance of each element.
   */
  const scan = (): void => {
    const at = performance.now();

    for (const element of document.querySelectorAll('body *')) {
      const { width, height } = element.getBoundingClientRect();

      if (
        !element.closest('script, style, template, [hidden]') &&
        width > 0 &&
        height > 0 &&
        getComputedStyle(element).visibility !== 'hidden'
      ) {
        if (state.shellAt === undefined) {
          state.shellAt = at;
          record('shell');
        }

        if (!seen.has(element)) {
          seen.set(element, at);
        }
      }
    }
  };
  const observer = new MutationObserver(scan);

  observer.observe(document, { childList: true, subtree: true, attributes: true });

  const originalError = console.error;

  /**
   * Retain console failures while preserving normal browser logging.
   */
  console.error = (...args: unknown[]): void => {
    errors.push(args.map(String).join(' '));
    originalError(...args);
  };

  /**
   * Collect uncaught browser errors for hydration assertions.
   */
  window.addEventListener('error', (event) => errors.push(event.message));

  /**
   * Collect unhandled promise failures for hydration assertions.
   */
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) =>
    errors.push(String(event.reason)),
  );

  /**
   * Snapshot the server root before the router begins hydration.
   */
  window.addEventListener('ssr-boost:router-ready', (event) => {
    const { rootId } = (event as CustomEvent<{ rootId: string }>).detail;
    const root = document.getElementById(rootId);

    if (root) {
      roots[rootId] = root.innerHTML;
    }

    scan();
    record('router.ready');
  });

  /**
   * Mark completion of the browser's document load.
   */
  window.addEventListener('load', () => record('response.end'), { once: true });

  const queue: unknown[][] = [];
  let downstream = Array.prototype.push;
  const observed = new WeakSet<unknown[]>();

  // The browser receiver replaces push; retain observation around that replacement.
  Object.defineProperty(queue, 'push', {
    configurable: true,

    /**
     * Observe each transport frame once before forwarding it to the receiver.
     */
    get:
      () =>
      (...frames: unknown[][]): number => {
        for (const frame of frames) {
          if (observed.has(frame)) {
            continue;
          }

          observed.add(frame);
          const [stage, id] = frame;

          if (stage === 'init' || stage === 'resolve' || stage === 'reject') {
            record(stage, typeof id === 'number' ? id : undefined);
          }
        }

        return downstream.apply(queue, frames) as number;
      },

    /**
     * Retain the browser receiver when it replaces queue delivery.
     */
    set: (replacement: typeof downstream) => {
      downstream = replacement;
    },
  });
  Reflect.set(window, '__ssrBoostStream', queue);
};

/** Compare server text multiplicities to the hydrated root, allowing existing repeats. */
const inspectHydration = (selector: string): IHydrationInspection => {
  const state = window.__ssrBoostTest;
  const root = document.querySelector(selector);
  const html = root ? state?.roots[root.id] : undefined;
  const server = document.createElement('div');

  server.innerHTML = html ?? '';

  /**
   * Count visible text fragments without including scripts or hidden boundaries.
   */
  const texts = (element: Element): Map<string, number> => {
    const counts = new Map<string, number>();

    for (const child of [element, ...element.querySelectorAll('*')]) {
      if (child.closest('script, style, template, [hidden]')) {
        continue;
      }

      const text = [...child.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent)
        .join('')
        .replace(/\s+/g, ' ')
        .trim();

      if (text) {
        counts.set(text, (counts.get(text) ?? 0) + 1);
      }
    }

    return counts;
  };
  const before = texts(server);
  const after = root ? texts(root) : new Map<string, number>();

  /**
   * Count exact and concatenated copies of one server text fragment.
   */
  const multiplicity = (counts: Map<string, number>, text: string): number => {
    let total = 0;

    for (const [candidate, count] of counts) {
      /**
       * Also catch concatenated copies in a single text node, without matching
       * short labels inside unrelated deferred content (for example 1 inside 100).
       */
      const copies = candidate.length / text.length;

      if (Number.isInteger(copies) && text.repeat(copies) === candidate) {
        total += copies * count;
      }
    }

    return total;
  };
  const duplicates = [...before]
    .filter(([text]) => multiplicity(after, text) > multiplicity(before, text))
    .map(([text]) => text);
  const walker = root ? document.createTreeWalker(root, NodeFilter.SHOW_COMMENT) : undefined;
  let pending = 0;

  while (walker?.nextNode()) {
    if (walker.currentNode.textContent === '$?') {
      pending++;
    }
  }

  return {
    ready: html !== undefined,
    consumed: Reflect.get(window, '__staticRouterHydrationData') === undefined,
    pending,
    duplicates,

    /**
     * Select React hydration failures from the collected browser errors.
     */
    errors:
      state?.errors.filter((error) =>
        /(?:#|errors\/)(418|423|425)\b|hydrat(?:ion|ing|e|ed)|server rendered HTML|did not match/i.test(
          error,
        ),
      ) ?? [],
  };
};

export { installBrowserObserver, inspectHydration };

export type { IBrowserTimelineEvent, IHydrationInspection };
