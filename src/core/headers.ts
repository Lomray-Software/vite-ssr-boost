export const getHeaderEntries = (headers: Headers): [string, string][] => {
  const entries: [string, string][] = [];

  headers.forEach((value, name) => {
    if (name.toLowerCase() !== 'set-cookie') {
      entries.push([name, value]);
    }
  });

  return entries;
};

export const getSetCookieHeaders = (headers: Headers): string[] => headers.getSetCookie();

/** Response headers override hook headers, while every Set-Cookie remains independent. */
export const mergeResponseHeaders = (response: Response, base: Headers): Response => {
  const headers = new Headers(base);

  getHeaderEntries(response.headers).forEach(([name, value]) => headers.set(name, value));
  getSetCookieHeaders(response.headers).forEach((cookie) => headers.append('Set-Cookie', cookie));

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
};
