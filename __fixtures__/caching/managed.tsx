import entryServer from '@lomray/vite-ssr-boost/adapters/express/entry';
import React from 'react';
import { rules, sessionCookie } from './policy';

export default entryServer(
  ({ children }) => children,
  [{ path: '/guest', Component: () => <main>Public guest content</main> }],
  { init: () => ({ documentHeaders: rules, sessionCookie }) },
);
