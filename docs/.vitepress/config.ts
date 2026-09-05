import { defineConfig } from 'vitepress';

const title = 'Vite SSR BOOST';
const description =
  'SSR for React Router apps in Data mode. Keep your Vite config, route objects and components, and build SSR or SPA output.';

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
          { text: 'Migrate an Existing SPA', link: '/guide/migrate-existing-spa' },
          { text: 'Choosing an SSR Approach', link: '/guide/choosing' },
          { text: 'Rendering Modes', link: '/guide/rendering-modes' },
          { text: 'Routing', link: '/guide/routing' },
          { text: 'Server Lifecycle', link: '/guide/server-lifecycle' },
          { text: 'Runtime Adapters', link: '/guide/runtime-adapters' },
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
        items: [
          { text: 'Example Projects', link: '/examples/' },
          { text: 'Recipes', link: '/examples/recipes' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'AI Usage', link: '/ai-usage' },
          { text: 'Talking Points', link: '/reference/talking-points' },
          { text: 'FAQ', link: '/reference/faq' },
          { text: 'Acceptance Gates', link: '/reference/acceptance-gates' },
          { text: 'Useful Links', link: '/reference/useful-links' },
        ],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/Lomray-Software/vite-ssr-boost' },
    ],
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © Lomray Software',
    },
  },
});
