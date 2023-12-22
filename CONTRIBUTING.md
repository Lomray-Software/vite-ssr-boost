# How to contribute

- [System requirements](#system-requirements)
- [Basics](#basics)

## System requirements

> These requirements are only needed for developing the source code.

- Node.js `>= v18.19.0`.
- [npm](https://www.npmjs.com/).

## Basics

#### Install

Download repo and install dependencies:

```shell
git clone git@github.com:Lomray-Software/vite-ssr-boost.git
npm i
```

#### Build & Dev

Build source code:

```shell
npm run build
```

Develop:

```shell
npm run build:watch
```

Check develop progress in any test repo:

```ecmascript 6
// modify rollup.config.js (don't commit)
// other imports

const dest = '../vite-template/node_modules/@lomray/vite-ssr-boost';

export default {
  input: [
    'src/**/*.ts*',
  ],
  output: {
    dir: dest,
    // other options
  },
  // other options
  plugins: [
    // other plugins
    // terser(),
    copy({
      targets: [
        { src: 'package.json', dest: dest },
        { src: 'README.md', dest: dest },
        { src: 'workflow', dest: dest },
      ]
    })
  ],
};
```

#### Test & Checks

Write test on new code, see [__tests__](__tests__) to more understand.

Run checks:

```shell
npm run lint:check
npm run ts:check
npm run test
```

Create PR into `staging` branch.
