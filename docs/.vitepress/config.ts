import { defineConfig } from 'vitepress';

const title = 'Vite SSR BOOST';
const description =
  'SSR for React Router apps in Data mode. Keep your Vite config, route objects and components, and build SSR or SPA output.';

export default defineConfig({
  title,
  description,
  base: '/vite-ssr-boost/',
  head: [
    [
      'link',
      { rel: 'icon', type: 'image/png', sizes: '64x64', href: '/vite-ssr-boost/favicon.png' },
    ],
    ['meta', { property: 'og:title', content: title }],
    ['meta', { property: 'og:description', content: description }],
    [
      'meta',
      {
        property: 'og:image',
        content: 'https://lomray-software.github.io/vite-ssr-boost/logo.png',
      },
    ],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { name: 'twitter:card', content: 'summary' }],
  ],
  cleanUrls: true,
  lastUpdated: true,
  sitemap: {
    hostname: 'https://lomray-software.github.io/vite-ssr-boost/',
  },
  themeConfig: {
    logo: '/logo.png',
    siteTitle: 'Vite SSR BOOST',
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
          { text: 'Incremental SSR', link: '/guide/incremental-ssr' },
          { text: 'Upgrade from 7 to 8', link: '/guide/upgrade-v8' },
          { text: 'Choosing an SSR Approach', link: '/guide/choosing' },
          { text: 'Rendering Modes', link: '/guide/rendering-modes' },
          { text: 'Routing', link: '/guide/routing' },
          { text: 'Stream loader data', link: '/guide/data-streaming' },
          { text: 'Testing', link: '/guide/testing' },
          { text: 'Server Lifecycle', link: '/guide/server-lifecycle' },
          { text: 'Runtime Adapters', link: '/guide/runtime-adapters' },
          { text: 'Deployment', link: '/guide/deployment' },
          { text: 'Caching', link: '/guide/caching' },
          { text: 'Cloudflare Workers', link: '/guide/cloudflare' },
        ],
      },
      {
        text: 'API',
        items: [
          { text: 'Plugin', link: '/api/plugin' },
          { text: 'Browser Entry', link: '/api/browser-entry' },
          { text: 'Server Entry', link: '/api/server-entry' },
          { text: 'Node Production', link: '/api/node-production' },
          { text: 'Testing', link: '/api/testing' },
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
          { text: 'Support and versions', link: '/reference/support' },
          { text: 'Talking Points', link: '/reference/talking-points' },
          { text: 'Hydration order and streaming', link: '/reference/hydration-and-streaming' },
          { text: 'FAQ', link: '/reference/faq' },
          { text: 'Diagnostics', link: '/reference/diagnostics' },
          { text: 'Acceptance Gates', link: '/reference/acceptance-gates' },
          { text: 'Useful Links', link: '/reference/useful-links' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/Lomray-Software/vite-ssr-boost' }],
    footer: {
      message:
        'Released under the MIT License. &middot; <a href="https://audit.lomray.com/?utm_source=github-pages&amp;utm_medium=docs-vite-ssr-boost&amp;utm_campaign=owned-surface-github" target="_blank" rel="noopener">Free performance audit for your deployed app</a>',
      copyright: 'Copyright © Lomray Software',
    },
  },
});
