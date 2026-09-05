type TNodeHeaders = Record<string, string | string[] | number | undefined>;

/**
 * Convert Node headers to Fetch headers, excluding HTTP/2 pseudo-headers.
 */
const createHeaders = (values: TNodeHeaders): Headers => {
  const headers = new Headers();

  for (const [name, value] of Object.entries(values)) {
    if (name.startsWith(':') || value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item);
      }
    } else {
      headers.set(name, typeof value === 'number' ? String(value) : value);
    }
  }

  return headers;
};

export default createHeaders;
