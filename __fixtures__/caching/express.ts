import adapterExpress from '@lomray/vite-ssr-boost/adapters/express';
import renderToStream from '@lomray/vite-ssr-boost/node/render-to-stream';
import express from 'express';
import { createPageHandler } from './app';

export const app = express();

app.disable('etag');
app.use(adapterExpress(createPageHandler(renderToStream)));

// The launcher calls start(); tests bind an ephemeral port on app instead.
export const start = () => app.listen(3000, '127.0.0.1');
