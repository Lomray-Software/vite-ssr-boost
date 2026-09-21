import type { StaticHandlerContext } from 'react-router';

export interface ICachedNotFoundOptions {
  /** Buffer and retain runtime-rendered router 404 documents. */
  mode: 'cached';
  /** Partition anonymous documents. Default: one shared key. */
  key?: (request: Request) => string;
  /** Maximum retained documents, evicted least recently used first. Default: 16. */
  maxEntries?: number;
}

export type TNotFoundOptions =
  | 'render'
  | 'spa'
  | 'cached'
  | ICachedNotFoundOptions
  | Response
  | ((request: Request) => Response | Promise<Response>);

interface ICachedDocument {
  /** Buffered bytes avoid retained streams or shared response bodies. */
  html: string;
  /** Anonymous response metadata. */
  headers: Headers;
  /** Preserve failures without storing them. */
  status: number;
  /** Anonymous router metadata for per-request document rules. */
  routerContext?: StaticHandlerContext;
}

export interface INotFoundRenderResult {
  /** Response from the anonymous render. */
  response: Response;
  /** Router/render failures must never populate the cache. */
  isCacheable: boolean;
  /** Router metadata used by document header rules on cache hits. */
  routerContext?: StaticHandlerContext;
}

/** Process-lifetime LRU with one in-flight render per application key. */
class NotFoundCache {
  /** Retain only completed successful 404 documents. */
  protected readonly entries = new Map<string, ICachedDocument>();

  /** Share cold renders without sharing consumable Response bodies. */
  protected readonly pending = new Map<string, Promise<ICachedDocument>>();

  /** Validate cache bounds at startup. */
  public constructor(
    /** Cache partitioning and bounded retention. */
    protected readonly options: ICachedNotFoundOptions = { mode: 'cached' },
  ) {
    const { maxEntries = 16 } = options;

    if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
      throw new Error('404 cache maxEntries must be a positive integer.');
    }
  }

  /** Render with no credentials; HEAD can warm the same complete document as GET. */
  public async get(
    request: Request,
    render: (anonymous: Request) => Promise<INotFoundRenderResult>,
    prepareHeaders?: (headers: Headers, routerContext?: StaticHandlerContext) => Headers,
  ): Promise<Response> {
    const key = this.options.key?.(request) ?? '';
    let document = this.entries.get(key);

    if (document) {
      this.entries.delete(key);
      this.entries.set(key, document);
    } else {
      let pending = this.pending.get(key);

      if (!pending) {
        const headers = new Headers(request.headers);

        headers.delete('Cookie');
        headers.delete('Authorization');
        headers.delete('Content-Length');
        const anonymous = new Request(request.url, { headers, method: 'GET' });

        pending = this.render(key, anonymous, render);
        this.pending.set(key, pending);
      }

      document = await pending;
    }

    return new Response(
      request.method === 'HEAD' || [204, 205, 304].includes(document.status) ? null : document.html,
      {
        headers: prepareHeaders?.(document.headers, document.routerContext) ?? document.headers,
        status: document.status,
      },
    );
  }

  /** Buffer first; a thrown render or read never leaves a poisoned cache entry. */
  protected async render(
    key: string,
    request: Request,
    render: (anonymous: Request) => Promise<INotFoundRenderResult>,
  ): Promise<ICachedDocument> {
    try {
      const { response, isCacheable, routerContext } = await render(request);
      const headers = new Headers(response.headers);

      // A shared document must never replay a cookie issued during the anonymous render.
      headers.delete('Set-Cookie');

      const document = {
        html: await response.text(),
        headers,
        status: response.status,
        routerContext,
      };

      if (isCacheable && response.status === 404) {
        this.entries.set(key, document);

        while (this.entries.size > (this.options.maxEntries ?? 16)) {
          const [oldest] = this.entries.keys();

          this.entries.delete(oldest);
        }
      }

      return document;
    } finally {
      this.pending.delete(key);
    }
  }
}

export default NotFoundCache;
