import { defineConfig } from 'vitepress';

const title = 'Vite SSR BOOST';
const description =
  'SSR and SPA toolkit for React Router applications on top of Vite, with server rendering, streaming and deployment helpers.';

export default defineConfig({
  title,
  description,
  base: '/vite-ssr-boost/',
  cleanUrls: true,
  lastUpdated: true,
  sitemap: {
    hostname: 'https://lomray-software.github.io/vite-ssr-boost/',
  },
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'API', link: '/api/plugin' },
      { text: 'Examples', link: '/examples/recipes' },
      { text: 'AI Usage', link: '/ai-usage' },
      {
        text: 'GitHub',
        link: 'https://github.com/Lomray-Software/vite-ssr-boost',
      },
    ],
    search: {
      provider: 'local',
    },
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Introduction', link: '/' },
          { text: 'Getting Started', link: '/guide/getting-started' },
          { text: 'Rendering Modes', link: '/guide/rendering-modes' },
          { text: 'Routing', link: '/guide/routing' },
          { text: 'Server Lifecycle', link: '/guide/server-lifecycle' },
          { text: 'Deployment', link: '/guide/deployment' },
        ],
      },
      {
        text: 'API',
        items: [
          { text: 'Plugin', link: '/api/plugin' },
          { text: 'Browser Entry', link: '/api/browser-entry' },
          { text: 'Server Entry', link: '/api/server-entry' },
          { text: 'Components And Helpers', link: '/api/components-and-helpers' },
          { text: 'CLI', link: '/api/cli' },
        ],
      },
      {
        text: 'Examples',
        items: [{ text: 'Recipes', link: '/examples/recipes' }],
      },
      {
        text: 'Reference',
        items: [
          { text: 'AI Usage', link: '/ai-usage' },
          { text: 'Talking Points', link: '/reference/talking-points' },
          { text: 'Useful Links', link: '/reference/useful-links' },
        ],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/Lomray-Software/vite-ssr-boost' },
    ],
    footer: {
      message:
        'Released under the MIT License. &middot; <a href="https://audit.lomray.com/?utm_source=github-pages&amp;utm_medium=docs-vite-ssr-boost&amp;utm_campaign=owned-surface-github" target="_blank" rel="noopener">Free performance audit for your deployed app</a>',
      copyright: 'Copyright © Lomray Software',
    },
  },
});
