import entry from '@lomray/vite-ssr-boost/browser/entry';
import { App, routes } from './routes.jsx';
void entry(App, routes, {
  init: async () => {
    if (!window.custom?.ready) throw new Error('Custom state missing before hydration');
  },
});
