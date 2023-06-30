import type { IRenderOptions } from '@node/render';

/**
 * Build custom state
 */
function buildCustomState(initState?: ReturnType<NonNullable<IRenderOptions['getState']>>): string {
  const stateScripts = Object.entries(initState ?? {}).map(([key, state]) => {
    if (!key || !state || !Object.keys(state || {}).length) {
      return '';
    }

    return `<script async>window.${key} = ${JSON.stringify(state)}</script>`;
  });

  return stateScripts.join('').trim();
}

export default buildCustomState;
