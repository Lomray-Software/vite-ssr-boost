import type { IBuildParams } from '@services/build';

/**
 * Small focus only helper to provide simple and useful methods to detect focus state
 */
const createFocusOnly = (focus: IBuildParams['focusOnly']) => ({
  isOnlyClient: () => focus === 'client',
  isClient: () => ['all', 'app', 'client'].includes(focus!),
  isServer: () => ['all', 'app', 'server'].includes(focus!),
  isEndpoint: () => ['all', 'endpoint'].includes(focus!),
});

export default createFocusOnly;
