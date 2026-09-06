import { documentHeaders } from '@lomray/vite-ssr-boost/http';
import type { ICoreRenderOptions } from '@lomray/vite-ssr-boost/core/render';
import { rules, sessionCookie } from './policy';

const finalize = documentHeaders(rules, { sessionCookie });

// Equivalent to the handler's documentHeaders option. Prefer onShellReady so that
// cookies written by earlier hooks are visible when the privacy default runs.
export const onShellReady: ICoreRenderOptions['onShellReady'] = ({ context }) => {
  context.response.headers = finalize(context);

  return {};
};
