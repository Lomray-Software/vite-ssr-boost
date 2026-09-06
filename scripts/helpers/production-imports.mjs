import { register } from 'node:module';
import { isMainThread } from 'node:worker_threads';

if (isMainThread) {
  register(import.meta.url);
}

/**
 * Reject tooling in a separate startup probe so tracing cannot affect budget samples.
 */
export const resolve = async (specifier, context, nextResolve) => {
  const result = await nextResolve(specifier, context);
  const { url } = result;

  if (
    /\/node_modules\/(?:vite|rolldown|rollup|commander|diff|parse5|semver|json5|@babel\/[^/]+)\//.test(url) ||
    /\/vite-ssr-boost\/(?:cli\/(?:commands|build|doctor|init|run-dev)|services\/(?:build|ssr-manifest|parse-routes|path-normalize|source-files)|plugins\/)/.test(url)
  ) {
    throw new Error(`Production imported tooling: ${url}`);
  }

  return result;
};
