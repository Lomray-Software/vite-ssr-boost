import type { TSsrHandler } from '@core/types';

const adapterEdge = (handler: TSsrHandler): TSsrHandler => handler;

export default adapterEdge;
