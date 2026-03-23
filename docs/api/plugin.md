# Plugin

## Import

```ts
import SsrBoost from '@lomray/vite-ssr-boost/plugin';
```

## Minimal usage

```ts
plugins: [SsrBoost(), react()];
```

## Options

```ts
interface IPluginOptions {
  indexFile?: string;
  serverFile?: string;
  clientFile?: string;
  routesPath?: string;
  spaIndex?: boolean | {
    filename?: string;
    rootId?: string;
  };
  tsconfigAliases?: boolean | {
    root?: string;
    tsconfig?: string;
  };
  customShortcuts?: {
    key: string;
    description: string;
    action: (cliContext) => Promise<void> | void;
    isOnlyDev?: boolean;
  }[];
  entrypoint?: IBuildEntrypoint[];
}
```

## Defaults

```ts
{
  indexFile: 'index.html',
  serverFile: 'server.ts',
  clientFile: 'client.ts',
  tsconfigAliases: true,
  spaIndex: false,
}
```

## What the plugin does

At a high level it:

- sets `__IS_SSR__`
- prepares SSR build config behavior
- enables tsconfig alias import support
- can generate an extra SPA index
- can swap client entrypoints for custom builds
- normalizes route handling for manifest generation

## `spaIndex`

Set `spaIndex: true` to emit `index-spa.html`.

Custom form:

```ts
SsrBoost({
  spaIndex: {
    filename: 'index-spa.html',
    rootId: 'root',
  },
});
```

The generated file marks the root with `data-force-spa="1"` so the browser entry mounts instead of hydrating.

## `tsconfigAliases`

Enabled by default.

Use `false` if you do not want aliases from tsconfig copied into Vite config. Use the object form if your alias resolution needs custom parameters from the alias plugin.

## `entrypoint`

`entrypoint` defines additional app surfaces for build time.

```ts
interface IBuildEntrypoint {
  name: string;
  type: 'spa' | 'ssr';
  indexFile?: string;
  clientFile?: string;
  serverFile?: string;
  buildOptions?: string;
}
```

Example:

```ts
SsrBoost({
  entrypoint: [
    {
      name: 'mobile',
      type: 'spa',
      clientFile: './src/mobile.tsx',
      buildOptions: '--mode mobile',
    },
  ],
});
```

## `customShortcuts`

Lets you extend interactive CLI keyboard actions in development.

Use this when your team has dev-only restart, cache or environment actions that should be one keypress away from the running dev process.
