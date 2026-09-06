// Server-only HTTP helpers use Fetch primitives and can also run on the edge.
export { default as cacheControl } from '@core/cache-control';

export type { ICachePolicy } from '@core/cache-control';

export { default as conditionalRequest } from '@core/conditional-request';

export type { IConditionalValidators } from '@core/conditional-request';

export { default as copyLoaderHeaders } from '@core/copy-loader-headers';

export { default as documentHeaders } from '@core/document-headers';

export type {
  IDocumentHeaderContext,
  IDocumentHeaderRule,
  IDocumentHeadersOptions,
  IDocumentRuleContext,
} from '@core/document-headers';
