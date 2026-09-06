import script from '@core/script';
import htmlEscape from '@helpers/html-escape';
import type Diagnostics from '@services/diagnostics';

/**
 * Build custom state
 */
function buildCustomState(
  initState?: Record<string, Record<string, any>> | void,
  diagnostics?: Diagnostics,
  nonce?: string,
  isTemporary = false,
): string {
  diagnostics?.inspectState(initState);

  const stateScripts = Object.entries(initState ?? {}).map(([key, state]) => {
    if (!key || !state || !Object.keys(state || {}).length) {
      return '';
    }

    const json = htmlEscape(JSON.stringify(JSON.stringify(state)));
    const property = /^[A-Za-z_$][\w$]*$/.test(key)
      ? `.${key}`
      : `[${htmlEscape(JSON.stringify(key))}]`;

    return script(`window${property} = JSON.parse(${json});`, nonce, isTemporary);
  });

  return stateScripts.join('').trim();
}

export default buildCustomState;
