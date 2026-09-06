import fs from 'node:fs';
import path from 'node:path';
import type { Node, ObjectExpression } from '@babel/types';
import JSON5 from 'json5';
import { parse as parseHtml } from 'parse5';
import type { DefaultTreeAdapterTypes } from 'parse5';
import type { Alias } from 'vite';
import PLUGIN_NAME from '@constants/plugin-name';
import SourceFiles, { propertyName, sourceError, unwrap } from '@services/source-files';

export const MANUAL_GUIDE =
  'https://lomray-software.github.io/vite-ssr-boost/guide/migrate-existing-spa';

export interface IPackage {
  version?: string;
  engines?: { node?: string };
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

export interface IEdit {
  start: number;
  end: number;
  text: string;
}

/** Apply non-overlapping source edits, preserving everything around them. */
export const editText = (code: string, edits: IEdit[]): string =>
  [...edits]
    .sort((left, right) => right.start - left.start)
    .reduce(
      (result, edit) => result.slice(0, edit.start) + edit.text + result.slice(edit.end),
      code,
    );

/** Infer the small formatting choices needed for inserted code. */
export const format = (
  code: string,
): { newline: string; quote: string; semicolon: string; indent: string } => ({
  newline: code.includes('\r\n') ? '\r\n' : '\n',
  quote: /(?:from\s+|import\s*)"/.test(code) ? '"' : "'",
  semicolon: /(?:from\s+['"][^'"]+['"]|\))\s*;/.test(code) ? ';' : '',
  indent: code.match(/\n([\t ]+)\S/)?.[1] ?? '  ',
});

export const readPackage = (file: string): IPackage =>
  JSON.parse(fs.readFileSync(file, 'utf8')) as IPackage;

/** Works in the source checkout and in the published cli/ directory. */
export const libraryPackage = (): IPackage => {
  const published = new URL('../package.json', import.meta.url);

  return readPackage(
    fs.existsSync(published)
      ? published.pathname
      : new URL('../../package.json', import.meta.url).pathname,
  );
};

export const objectProperty = (object: ObjectExpression, name: string): Node | undefined => {
  const property = object.properties.find((item) => propertyName(item) === name);

  return property?.type === 'ObjectProperty' ? unwrap(property.value) : undefined;
};

export const stringValue = (node?: Node): string | undefined =>
  node?.type === 'StringLiteral' ? node.value : undefined;

/** Read a conventional Vite config without evaluating plugins or env files. */
export const readConfig = (root: string) => {
  const candidates = ['ts', 'js', 'mts', 'mjs', 'cts', 'cjs']
    .map((extension) => path.join(root, `vite.config.${extension}`))
    .filter((file) => fs.existsSync(file));

  if (candidates.length !== 1) {
    throw sourceError(
      path.join(root, 'vite.config.*'),
      undefined,
      `Vite configs (${candidates.length}); expected exactly one`,
    );
  }

  const [file] = candidates;
  const sources = new SourceFiles();
  const { code, ast } = sources.read(file);
  let { node } = sources.exported(file);

  if (
    node.type === 'CallExpression' &&
    node.callee.type === 'Identifier' &&
    sources.import(file, node.callee.name)?.exported === 'defineConfig'
  ) {
    node = unwrap(node.arguments[0])!;
  }

  if (node?.type === 'ArrowFunctionExpression') {
    node = unwrap(node.body)!;
  }

  if (node?.type !== 'ObjectExpression') {
    throw sourceError(file, node, 'Vite configuration; use defineConfig({ ... })');
  }

  const rootNode = objectProperty(node, 'root');

  if (rootNode && rootNode.type !== 'StringLiteral') {
    throw sourceError(file, rootNode, 'Vite root; use a string literal');
  }

  const viteRoot = path.resolve(root, stringValue(rootNode) ?? '.');
  const plugins = objectProperty(node, 'plugins');
  const plugin =
    plugins?.type === 'ArrayExpression'
      ? plugins.elements.find((element) => {
          if (element?.type !== 'CallExpression' || element.callee.type !== 'Identifier') {
            return false;
          }

          return (
            sources.import(file, element.callee.name)?.source.replace(/\.js$/, '') ===
            `${PLUGIN_NAME}/plugin`
          );
        })
      : undefined;
  const options = plugin?.type === 'CallExpression' ? unwrap(plugin.arguments[0]) : undefined;

  if (options && options.type !== 'ObjectExpression') {
    throw sourceError(file, options, 'SsrBoost options; use an object literal');
  }

  const option = (name: string): Node | undefined =>
    options?.type === 'ObjectExpression' ? objectProperty(options, name) : undefined;
  const aliases: Alias[] = [];
  const resolve = objectProperty(node, 'resolve');
  const alias = resolve?.type === 'ObjectExpression' ? objectProperty(resolve, 'alias') : undefined;

  if (alias?.type === 'ObjectExpression') {
    for (const property of alias.properties) {
      if (property.type !== 'ObjectProperty') {
        continue;
      }

      const find = propertyName(property);
      let replacement = stringValue(unwrap(property.value));
      const value = unwrap(property.value);

      // Stock Vite alias: fileURLToPath(new URL('./src', import.meta.url)).
      const url = value?.type === 'CallExpression' ? value.arguments[0] : undefined;

      if (
        url?.type === 'NewExpression' &&
        url.callee.type === 'Identifier' &&
        url.callee.name === 'URL' &&
        url.arguments[0]?.type === 'StringLiteral'
      ) {
        replacement = path.resolve(root, url.arguments[0].value);
      }

      if (find && replacement) {
        aliases.push({ find, replacement });
      }
    }
  }

  const tsconfig = path.join(root, 'tsconfig.json');

  if (
    fs.existsSync(tsconfig) &&
    !(
      option('tsconfigAliases')?.type === 'BooleanLiteral' &&
      Reflect.get(option('tsconfigAliases')!, 'value') === false
    )
  ) {
    const ts = JSON5.parse<{
      compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
    }>(fs.readFileSync(tsconfig, 'utf8'));
    const base = path.resolve(root, ts.compilerOptions?.baseUrl ?? path.relative(root, viteRoot));

    for (const [find, replacements] of Object.entries(ts.compilerOptions?.paths ?? {})) {
      aliases.push({
        find: find.replace(/\/\*$/, ''),
        replacement: path.resolve(base, replacements[0].replace(/\/\*$/, '')),
      });
    }
  }

  return { file, code, ast, node, viteRoot, plugins, plugin, option, aliases, sources };
};

/** HTML locations come from an HTML parser, so comments and attribute order are harmless. */
export const readHtml = (
  file: string,
): {
  code: string;
  entries: DefaultTreeAdapterTypes.Element[];
  roots: DefaultTreeAdapterTypes.Element[];
  outlets: number;
  attribute: (node: DefaultTreeAdapterTypes.Element, name: string) => string | undefined;
} => {
  const code = fs.readFileSync(file, 'utf8');
  const document = parseHtml(code, { sourceCodeLocationInfo: true });
  const elements: DefaultTreeAdapterTypes.Element[] = [];
  const outlets = code.split('<!--ssr-outlet-->').length - 1;

  const visit = (node: DefaultTreeAdapterTypes.Node): void => {
    if ('tagName' in node) {
      elements.push(node);
    }

    if ('childNodes' in node) {
      node.childNodes.forEach(visit);
    }
  };

  visit(document);

  const attribute = (node: DefaultTreeAdapterTypes.Element, name: string): string | undefined =>
    node.attrs.find((attr) => attr.name === name)?.value;
  const entries = elements.filter(
    (node) => node.tagName === 'script' && attribute(node, 'type') === 'module',
  );
  const roots = elements.filter((node) => attribute(node, 'id') === 'root');

  return { code, entries, roots, outlets, attribute };
};

export type TProjectConfig = ReturnType<typeof readConfig>;
