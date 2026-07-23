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
