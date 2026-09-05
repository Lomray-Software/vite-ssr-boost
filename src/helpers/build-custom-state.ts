import htmlEscape from '@helpers/html-escape';

/**
 * Build custom state
 */
function buildCustomState(initState?: Record<string, Record<string, any>> | void): string {
  const stateScripts = Object.entries(initState ?? {}).map(([key, state]) => {
    if (!key || !state || !Object.keys(state || {}).length) {
      return '';
    }

    const json = htmlEscape(JSON.stringify(JSON.stringify(state)));
    const property = /^[A-Za-z_$][\w$]*$/.test(key)
      ? `.${key}`
      : `[${htmlEscape(JSON.stringify(key))}]`;

    return `<script async>window${property} = JSON.parse(${json});</script>`;
  });

  return stateScripts.join('').trim();
}

export default buildCustomState;
