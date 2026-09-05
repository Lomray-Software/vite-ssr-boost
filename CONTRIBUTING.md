# How to contribute

- [System requirements](#system-requirements)
- [Basics](#basics)

## System requirements

> These requirements are only needed for developing the source code.

- Node.js `^22.22.2 || >=24.15.0`; `.nvmrc` pins the version used by CI.
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

```shell
# Install vite-template in a sibling directory first.
npm run test:template
```

The acceptance script copies the template to a temporary directory, installs the locally packed library with its dependencies and
migrates its server entry import to `adapters/express/entry`. To retain that copy for browser checks, run
`SSR_BOOST_KEEP_TEMPLATE=1 npm run test:template`; its path is printed at the end.
Set `SSR_BOOST_TEMPLATE_CURRENT=1` to also upgrade the copy to the library's current Vite, React,
React Router and Babel versions after measuring the original baseline.

#### Test & Checks

Write test on new code, see [__tests__](__tests__) to more understand.

Run checks:

```shell
npm run lint:check
npm run ts:check
npm run test
```

Create PR into `staging` branch.

Use Conventional Commits for commits and PR titles: `fix:` releases a patch, `feat:` a minor,
and `feat!:` or a `BREAKING CHANGE:` footer a major. Keep the breaking marker when squash-merging.
