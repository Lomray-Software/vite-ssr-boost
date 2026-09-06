import type { StaticHandlerContext } from 'react-router';
import { getHeaderEntries, getSetCookieHeaders } from '@core/headers';

export interface IDocumentHeadersOptions {
  /** Exact, case-sensitive cookie name. Empty values count as present. */
  sessionCookie?: string;
  /** Explicit escape hatch: let rules control credentialed responses too. Default: true. */
  protectPrivate?: boolean;
}

export interface IDocumentHeaderContext {
  request: Request;
  routerContext?: StaticHandlerContext;
  response: { headers: Headers };
}

export interface IDocumentRuleContext {
  request: Request;
  url: URL;
  /** User-Agent heuristic for policy selection, never an authentication signal. */
  isBot: boolean;
  hasCookie: (name: string) => boolean;
  routerContext?: StaticHandlerContext;
}

export interface IDocumentHeaderRule {
  when: (context: IDocumentRuleContext) => boolean;
  set: HeadersInit;
}

/** Test cookie presence without decoding, exposing, or comparing credential values. */
export const hasCookie = (request: Request, name: string): boolean =>
  (request.headers.get('Cookie') ?? '').split(';').some((cookie) => {
    const separator = cookie.indexOf('=');

    return separator !== -1 && cookie.slice(0, separator).trim() === name;
  });

/**
 * Compute fresh document headers after hooks. Later rules replace ordinary fields;
 * cookies append. Credential protection runs last unless explicitly disabled.
 */
const documentHeaders = (
  rules: readonly IDocumentHeaderRule[],
  { sessionCookie, protectPrivate = true }: IDocumentHeadersOptions = {},
): ((context: IDocumentHeaderContext) => Headers) => {
  return ({ request, routerContext, response }) => {
    const headers = new Headers(response.headers);
    const ruleContext: IDocumentRuleContext = {
      request,
      url: new URL(request.url),
      isBot: /bot|crawler|spider|crawling/i.test(request.headers.get('User-Agent') ?? ''),
      hasCookie: (name) => hasCookie(request, name),
      routerContext,
    };

    for (const rule of rules) {
      if (!rule.when(ruleContext)) {
        continue;
      }

      const selected = new Headers(rule.set);

      getHeaderEntries(selected).forEach(([name, value]) => headers.set(name, value));
      getSetCookieHeaders(selected).forEach((cookie) => headers.append('Set-Cookie', cookie));
    }

    if (
      protectPrivate &&
      (headers.has('Set-Cookie') ||
        request.headers.has('Authorization') ||
        (sessionCookie && hasCookie(request, sessionCookie)))
    ) {
      headers.set('Cache-Control', 'private, no-store');
    }

    // Vary: Cookie fragments a shared cache by entire cookie strings. Bypass the
    // cache on session presence instead; this helper never emits that Vary token.
    const vary = (headers.get('Vary') ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name && name.toLowerCase() !== 'cookie');

    if (vary.length) {
      headers.set('Vary', vary.join(', '));
    } else {
      headers.delete('Vary');
    }

    return headers;
  };
};

export default documentHeaders;
