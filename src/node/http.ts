import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Http2ServerRequest, Http2ServerResponse } from 'node:http2';

export type TIncomingMessage = IncomingMessage | Http2ServerRequest;

export type TServerResponse = ServerResponse | Http2ServerResponse;
