import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Copy source-only fixtures into disposable projects. */
export const copyFixture = (layout: string): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ssr-boost-init-test-'));
  const source = path.resolve('__fixtures__/init', layout);

  for (const file of fs.readdirSync(source, { recursive: true, encoding: 'utf8' })) {
    if (!file.endsWith('.txt')) {
      continue;
    }

    const destination = path.join(directory, file.slice(0, -4));

    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(source, file), destination);
  }

  return directory;
};

export const writeFixture = (root: string, file: string, value: string): void => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), value);
};

export interface IRouteFixture {
  client?: string;
  routes: string;
  files?: Record<string, string>;
}

export const routeFixtures = fs.readdirSync(path.resolve('__fixtures__/routes')).map((file) => ({
  name: file.replace('.json', ''),
  ...(JSON.parse(
    fs.readFileSync(path.resolve('__fixtures__/routes', file), 'utf8'),
  ) as IRouteFixture),
}));

export const writeRouteFixture = (root: string, fixture: IRouteFixture): void => {
  writeFixture(
    root,
    'client.ts',
    `import { Fragment as App } from 'react';\n${fixture.client ?? "import boot from '@lomray/vite-ssr-boost/browser/entry';\nimport routes from './routes';\nvoid boot(App, routes);\n"}`,
  );
  writeFixture(root, 'routes.ts', fixture.routes);
  writeFixture(root, 'About.tsx', 'export function Component() { return <h1>About route</h1>; }\n');

  for (const [file, content] of Object.entries(fixture.files ?? {})) {
    writeFixture(root, file, content);
  }
};
