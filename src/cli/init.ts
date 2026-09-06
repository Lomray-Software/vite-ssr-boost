import fs from 'node:fs';
import path from 'node:path';
import type { Node, CallExpression, ImportDeclaration } from '@babel/types';
import { createTwoFilesPatch } from 'diff';
import {
  editText,
  format,
  libraryPackage,
  MANUAL_GUIDE,
  objectProperty,
  readConfig,
  readHtml,
  readPackage,
  stringValue,
} from '@cli/project';
import type { IEdit } from '@cli/project';
import PLUGIN_NAME from '@constants/plugin-name';
import ParseRoutes from '@services/parse-routes';
import SourceFiles, { sourceError, unwrap, walk } from '@services/source-files';
import type { ISourceValue } from '@services/source-files';

export interface IInitOptions {
  root?: string;
  entry?: string;
  routes?: string;
  dryRun?: boolean;
  apply?: boolean;
}

export interface IFileChange {
  file: string;
  before: string;
  after: string;
}

/** Relative module specifier, valid for both TypeScript and JavaScript. */
const relativeImport = (from: string, to: string): string => {
  const relative = path.relative(path.dirname(from), to).split(path.sep).join('/');

  return relative.startsWith('.') ? relative : `./${relative}`;
};

/** Binding references used when extracting an inline route array. */
const namesIn = (node: Node): Set<string> => {
  const names = new Set<string>();

  walk(node, (child) => {
    if (child.type === 'Identifier' || child.type === 'JSXIdentifier') {
      names.add(child.name);
    }
  });

  return names;
};

/** Keep just the imported bindings needed by the extracted route module. */
const importText = (
  node: ImportDeclaration,
  names: Set<string>,
  source: string,
  quote: string,
  semicolon: string,
): string => {
  const specifiers = node.specifiers.filter((specifier) => names.has(specifier.local.name));
  const defaults = specifiers
    .filter((specifier) => specifier.type === 'ImportDefaultSpecifier')
    .map((specifier) => specifier.local.name);
  const namespaces = specifiers
    .filter((specifier) => specifier.type === 'ImportNamespaceSpecifier')
    .map((specifier) => `* as ${specifier.local.name}`);
  const named = specifiers.flatMap((specifier) => {
    if (specifier.type !== 'ImportSpecifier') {
      return [];
    }

    const imported =
      specifier.imported.type === 'Identifier'
        ? specifier.imported.name
        : `${quote}${specifier.imported.value}${quote}`;

    return [
      `${specifier.importKind === 'type' ? 'type ' : ''}${imported}${imported === specifier.local.name ? '' : ` as ${specifier.local.name}`}`,
    ];
  });
  const bindings = [
    ...defaults,
    ...namespaces,
    ...(named.length ? [`{ ${named.join(', ')} }`] : []),
  ];

  return bindings.length
    ? `import ${node.importKind === 'type' ? 'type ' : ''}${bindings.join(', ')} from ${quote}${source}${quote}${semicolon}`
    : '';
};

/** Find a usable export of a route array without importing the module. */
const arrayExports = (
  sources: SourceFiles,
  file: string,
): { name: string; value: ISourceValue }[] => {
  const names: string[] = [];

  for (const node of sources.read(file).ast.program.body) {
    if (node.type === 'ExportDefaultDeclaration') {
      names.push('default');
    }

    if (node.type === 'ExportNamedDeclaration') {
      if (node.declaration?.type === 'VariableDeclaration') {
        names.push(
          ...node.declaration.declarations.flatMap((declaration) =>
            declaration.id.type === 'Identifier' ? [declaration.id.name] : [],
          ),
        );
      }

      names.push(
        ...node.specifiers.map((specifier) =>
          specifier.exported.type === 'Identifier'
            ? specifier.exported.name
            : specifier.exported.value,
        ),
      );
    }
  }

  return names.flatMap((name) => {
    const value = sources.exported(file, name);

    return value.node.type === 'ArrayExpression' ? [{ name, value }] : [];
  });
};

/** Build all edits first. A failed analysis leaves even --apply completely untouched. */
export const planInit = (options: IInitOptions = {}): IFileChange[] => {
  const root = path.resolve(options.root ?? process.cwd());
  const config = readConfig(root);
  const { newline, quote, semicolon } = format(config.code);
  const changes: IFileChange[] = [];
  const add = (file: string, after: string): void => {
    const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';

    if (before !== after) {
      changes.push({ file: path.relative(root, file).split(path.sep).join('/'), before, after });
    }
  };
  const base = objectProperty(config.node, 'base');

  if (base && stringValue(base) !== '/') {
    throw sourceError(config.file, base, 'Vite base; automatic migration currently maps only /');
  }

  if (config.node.properties.some((property) => property.type === 'SpreadElement')) {
    throw sourceError(config.file, config.node, 'spread Vite configuration');
  }

  const build = objectProperty(config.node, 'build');
  const rollup =
    build?.type === 'ObjectExpression' ? objectProperty(build, 'rollupOptions') : undefined;

  if (
    config.option('entrypoint') ||
    (rollup?.type === 'ObjectExpression' && objectProperty(rollup, 'input'))
  ) {
    throw sourceError(config.file, rollup, 'multiple or custom build entries');
  }

  const indexFile = path.resolve(
    config.viteRoot,
    stringValue(config.option('indexFile')) ?? 'index.html',
  );
  const html = readHtml(indexFile);

  if (html.entries.length !== 1 || !html.attribute(html.entries[0], 'src')) {
    throw sourceError(
      indexFile,
      undefined,
      `module entries (${html.entries.length}); expected one external module script`,
    );
  }

  const src = html.attribute(html.entries[0], 'src')!;

  if (/^(?:\w+:|\/\/)|[?#]/.test(src)) {
    throw sourceError(indexFile, undefined, 'non-local browser entry URL');
  }

  const detectedEntry = path.resolve(
    src.startsWith('/') ? config.viteRoot : path.dirname(indexFile),
    src.replace(/^\//, ''),
  );
  const entry = options.entry ? path.resolve(root, options.entry) : detectedEntry;

  if (entry !== detectedEntry) {
    throw sourceError(indexFile, undefined, '--entry does not match the module script');
  }

  const sources = new SourceFiles(config.aliases);
  const { code, ast } = sources.read(entry);
  const entryFormat = format(code);
  const q = entryFormat.quote;
  const end = entryFormat.semicolon;
  const nl = entryFormat.newline;
  const isTS = /\.[cm]?tsx?$/.test(entry);
  const server = path.resolve(path.dirname(entry), `server.${isTS ? 'ts' : 'js'}`);
  const isAlready = ast.program.body.some(
    (node) =>
      node.type === 'ImportDeclaration' &&
      node.source.value.replace(/\.js$/, '') === `${PLUGIN_NAME}/browser/entry`,
  );

  if (isAlready) {
    if (!config.plugin || html.outlets !== 1 || !fs.existsSync(server)) {
      throw sourceError(
        entry,
        undefined,
        'partially configured SSR app; finish the migration using doctor',
      );
    }

    return [];
  }

  if (fs.existsSync(server)) {
    throw sourceError(server, undefined, 'existing server entry; refusing to overwrite');
  }

  if (html.roots.length !== 1 || !html.roots[0].sourceCodeLocation?.endTag || html.outlets > 1) {
    throw sourceError(
      indexFile,
      undefined,
      'root element; expected exactly one empty element with id="root"',
    );
  }

  const rootLocation = html.roots[0].sourceCodeLocation;
  const rootContents = html.code.slice(
    rootLocation.startTag!.endOffset,
    rootLocation.endTag!.startOffset,
  );

  if (rootContents.replace('<!--ssr-outlet-->', '').trim()) {
    throw sourceError(indexFile, undefined, 'non-empty root element');
  }

  const calls: CallExpression[] = [];
  const renders: CallExpression[] = [];

  walk(ast, (node) => {
    if (node.type !== 'CallExpression') {
      return;
    }

    if (node.callee.type === 'Identifier') {
      const imported = sources.import(entry, node.callee.name);

      if (
        imported?.exported === 'createBrowserRouter' &&
        ['react-router', 'react-router-dom'].includes(imported.source)
      ) {
        calls.push(node);
      }
    }

    if (
      node.callee.type === 'MemberExpression' &&
      node.callee.property.type === 'Identifier' &&
      node.callee.property.name === 'render'
    ) {
      renders.push(node);
    }
  });

  if (calls.length !== 1) {
    throw sourceError(
      entry,
      calls[1],
      `createBrowserRouter calls (${calls.length}); JSX BrowserRouter/Routes and router factories need manual migration`,
    );
  }

  const [call] = calls;

  if (call.arguments.length !== 1 || renders.length !== 1) {
    throw sourceError(
      entry,
      call,
      'router options or multiple React roots; migrate their settings manually',
    );
  }

  const [render] = renders;
  const rootCall =
    render.callee.type === 'MemberExpression'
      ? sources.resolve({ node: render.callee.object, file: entry }).node
      : undefined;

  if (
    rootCall?.type !== 'CallExpression' ||
    rootCall.callee.type !== 'Identifier' ||
    sources.import(entry, rootCall.callee.name)?.source !== 'react-dom/client' ||
    sources.import(entry, rootCall.callee.name)?.exported !== 'createRoot' ||
    rootCall.arguments.length !== 1 ||
    render.arguments.length !== 1
  ) {
    throw sourceError(
      entry,
      rootCall,
      'React mount; use createRoot(element).render(...) without custom options',
    );
  }

  // Reproduce the root tree in both environments. Built-ins must not receive entry props.
  const rendered = unwrap(render.arguments[0]);
  let provider = rendered;
  const wrappers: { tag: string; builtin: boolean }[] = [];
  const wrapperImports = new Map<ImportDeclaration, Set<string>>();

  while (provider?.type === 'JSXElement' || provider?.type === 'JSXFragment') {
    if (provider.type === 'JSXElement') {
      const { name } = provider.openingElement;
      const member =
        name.type === 'JSXMemberExpression' && name.object.type === 'JSXIdentifier'
          ? name
          : undefined;
      const local =
        name.type === 'JSXIdentifier'
          ? name.name
          : member?.object.type === 'JSXIdentifier'
            ? member.object.name
            : undefined;
      const namespace = ast.program.body.find(
        (node): node is ImportDeclaration =>
          node.type === 'ImportDeclaration' &&
          node.specifiers.some(
            (specifier) =>
              specifier.type === 'ImportNamespaceSpecifier' && specifier.local.name === local,
          ),
      );
      const binding = local
        ? (sources.import(entry, local) ??
          (namespace
            ? {
                declaration: namespace,
                source: namespace.source.value,
                exported: '*',
              }
            : undefined))
        : undefined;
      const isBuiltin =
        binding?.source === 'react' &&
        ['StrictMode', 'Fragment'].includes(member?.property.name ?? binding.exported);

      if (
        !member &&
        binding?.exported === 'RouterProvider' &&
        ['react-router', 'react-router-dom'].includes(binding.source)
      ) {
        break;
      }

      if (
        !local ||
        !binding ||
        (member && !isBuiltin) ||
        provider.openingElement.attributes.length
      ) {
        throw sourceError(
          entry,
          provider,
          'App wrapper; use an imported component without additional props',
        );
      }

      const names = wrapperImports.get(binding.declaration) ?? new Set<string>();

      names.add(local);
      wrapperImports.set(binding.declaration, names);
      wrappers.push({
        tag: member ? `${local}.${member.property.name}` : local,
        builtin: isBuiltin,
      });
    } else {
      wrappers.push({ tag: '', builtin: true });
    }

    const children = provider.children.filter(
      (child) => child.type !== 'JSXText' || child.value.trim(),
    );

    if (children.length !== 1) {
      throw sourceError(entry, provider, 'App wrapper; expected exactly one RouterProvider child');
    }

    [provider] = children;
  }

  if (provider?.type !== 'JSXElement') {
    throw sourceError(
      entry,
      rendered,
      'React root; expected an imported RouterProvider with optional App, StrictMode or Fragment wrappers',
    );
  }

  const [routerAttribute] = provider.openingElement.attributes;

  if (
    provider.openingElement.attributes.length !== 1 ||
    routerAttribute?.type !== 'JSXAttribute' ||
    routerAttribute.name.name !== 'router' ||
    routerAttribute.value?.type !== 'JSXExpressionContainer' ||
    sources.resolve({ node: routerAttribute.value.expression, file: entry }).node !== call
  ) {
    throw sourceError(
      entry,
      provider,
      'RouterProvider props; use the detected router without additional props',
    );
  }

  let appImport = [...wrapperImports]
    .map(([declaration, names]) => importText(declaration, names, declaration.source.value, q, end))
    .join(nl);
  let serverAppImport = appImport;
  let appDeclaration = '';
  let serverAppDeclaration = '';
  let appName = wrappers[0]?.tag ?? 'App';

  if (wrappers.length !== 1 || wrappers[0].builtin) {
    const reserved = new Set([...wrapperImports.values()].flatMap((names) => [...names]));
    const argument = unwrap(call.arguments[0]);

    if (argument?.type === 'Identifier') {
      reserved.add(argument.name);
    }

    const unique = (name: string): string => {
      let result = name;

      while (reserved.has(result)) {
        result += '_';
      }

      reserved.add(result);

      return result;
    };

    appName = unique('App');
    const fc = unique('FC');
    const props = unique('PropsWithChildren');
    const createElement = unique('ssrCreateElement');
    const fragment = unique('ssrFragment');
    const typeImport = isTS
      ? `import type { ${fc === 'FC' ? fc : `FC as ${fc}`}, ${props === 'PropsWithChildren' ? props : `PropsWithChildren as ${props}`} } from ${q}react${q}${end}`
      : '';
    const tree = wrappers.length ? wrappers : [{ tag: '', builtin: true }];
    const jsx = tree.reduceRight((child, { tag }) => `<${tag}>${child}</${tag}>`, '{children}');
    const expression = tree.reduceRight(
      (child, { tag }) => `${createElement}(${tag || fragment}, null, ${child})`,
      'children',
    );
    const definition = `const ${appName}${isTS ? `: ${fc}<${props}>` : ''} = ({ children }) => `;

    appImport = [appImport, typeImport].filter(Boolean).join(nl);
    serverAppImport = [
      appImport,
      `import { createElement as ${createElement}${tree.some(({ tag }) => !tag) ? `, Fragment as ${fragment}` : ''} } from ${q}react${q}${end}`,
    ]
      .filter(Boolean)
      .join(nl);
    serverAppDeclaration = `${definition}${expression}${end}${nl}`;
    // A .ts/.js entry cannot contain JSX; use the same React tree through createElement.
    appDeclaration = /\.[jt]sx$/.test(entry)
      ? `${definition}${jsx}${end}${nl}`
      : serverAppDeclaration;

    if (!/\.[jt]sx$/.test(entry)) {
      appImport = serverAppImport;
    }
  }

  const originalRoutes = sources.resolve({ node: call.arguments[0], file: entry });
  let routeValue = originalRoutes;
  let routeModule = routeValue.file;
  let routeExport =
    routeModule !== entry
      ? arrayExports(sources, routeModule).find((item) => item.value.node === routeValue.node)?.name
      : undefined;

  if (options.routes) {
    routeModule = sources.filename(
      relativeImport(entry, path.resolve(root, options.routes)),
      entry,
    );
    const exports = arrayExports(sources, routeModule);

    if (exports.length !== 1) {
      throw sourceError(
        routeModule,
        undefined,
        `exported route arrays (${exports.length}); --routes needs one exported array`,
      );
    }

    routeValue = exports[0].value;
    routeExport = exports[0].name;
  }

  new ParseRoutes({} as never).parseValue(sources, routeValue, true);

  const moved = new Set<Node>();

  if (!routeExport) {
    const source = sources.read(routeValue.file);
    const names = namesIn(routeValue.node);
    let previousSize = -1;

    while (previousSize !== names.size) {
      previousSize = names.size;

      for (const statement of source.ast.program.body) {
        const declaration =
          statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
        const declared =
          declaration?.type === 'VariableDeclaration'
            ? declaration.declarations.flatMap((item) =>
                item.id.type === 'Identifier' ? [item.id.name] : [],
              )
            : declaration?.type === 'FunctionDeclaration' && declaration.id
              ? [declaration.id.name]
              : [];

        if (declaration && declared.some((name) => names.has(name))) {
          if (
            declaration.start! <= routeValue.node.start! &&
            declaration.end! >= routeValue.node.end!
          ) {
            continue;
          }

          moved.add(statement);
          namesIn(declaration).forEach((name) => names.add(name));
        }
      }
    }

    const pieces: string[] = [];

    for (const statement of source.ast.program.body) {
      if (statement.type === 'ImportDeclaration') {
        const text = importText(statement, names, statement.source.value, q, end);

        if (text) {
          pieces.push(text);
        }
      } else if (moved.has(statement)) {
        pieces.push(source.code.slice(statement.start!, statement.end!));
      }
    }

    const extension = path.extname(routeValue.file);

    routeModule = path.resolve(path.dirname(routeValue.file), `routes.ssr${extension}`);

    if (fs.existsSync(routeModule)) {
      throw sourceError(routeModule, undefined, 'existing extracted routes file');
    }

    pieces.push(
      `export default ${source.code.slice(routeValue.node.start!, routeValue.node.end!)}${isTS ? " satisfies import('react-router').RouteObject[]" : ''}${end}`,
    );
    add(routeModule, `${pieces.join(nl + nl)}${nl}`);
    routeExport = 'default';
  }

  // Accept only the bootstrap and declarations that feed its route array; do not discard startup code.
  for (const statement of ast.program.body) {
    if (statement.type === 'VariableDeclaration' && statement.declarations.length !== 1) {
      throw sourceError(
        entry,
        statement,
        'multiple bootstrap declarators; put each declaration on its own statement',
      );
    }

    if (statement.type === 'ImportDeclaration' || moved.has(statement)) {
      continue;
    }

    if (
      [
        call,
        rootCall,
        render,
        ...(originalRoutes.file === entry ? [originalRoutes.node] : []),
      ].some((node) => node.start! >= statement.start! && node.end! <= statement.end!)
    ) {
      continue;
    }

    throw sourceError(
      entry,
      statement,
      'additional browser startup statement; move it to a shared wrapper or migrate manually',
    );
  }

  // Follow the original import, including aliases/re-export modules and extension spelling.
  const routeArgument = unwrap(call.arguments[0]);
  const routeBinding =
    routeArgument?.type === 'Identifier' ? sources.import(entry, routeArgument.name) : undefined;
  const shouldKeepRouteImport = routeBinding && routeValue.node === originalRoutes.node;
  const routeName =
    shouldKeepRouteImport && routeArgument?.type === 'Identifier'
      ? routeArgument.name
      : routeExport === 'default'
        ? 'routes'
        : routeExport;
  const routeImport = shouldKeepRouteImport
    ? importText(routeBinding.declaration, new Set([routeName]), routeBinding.source, q, end)
    : `import ${routeExport === 'default' ? routeName : `{ ${routeExport} }`} from ${q}${relativeImport(entry, routeModule).replace(/\.[cm]?[jt]sx?$/, '')}${q}${end}`;
  const sideEffects = ast.program.body
    .filter((node) => node.type === 'ImportDeclaration' && !node.specifiers.length)
    .map((node) => code.slice(node.start!, node.end!));

  add(
    entry,
    [
      `import entryClient from ${q}${PLUGIN_NAME}/browser/entry${q}${end}`,
      appImport,
      routeImport,
      ...sideEffects,
      '',
      ...(appDeclaration ? [appDeclaration] : []),
      `void entryClient(${appName}, ${routeName})${end}`,
      '',
    ].join(nl),
  );
  add(
    server,
    [
      `import entryServer from ${q}${PLUGIN_NAME}/adapters/express/entry${q}${end}`,
      serverAppImport,
      routeImport,
      '',
      ...(serverAppDeclaration ? [serverAppDeclaration] : []),
      `export default entryServer(${appName}, ${routeName})${end}`,
      '',
    ].join(nl),
  );

  const edits: IEdit[] = [];
  const pluginOptions = [
    `clientFile: ${quote}${path.relative(config.viteRoot, entry).split(path.sep).join('/')}${quote}`,
    `serverFile: ${quote}${path.relative(config.viteRoot, server).split(path.sep).join('/')}${quote}`,
  ];

  if (!fs.existsSync(path.join(root, 'tsconfig.json'))) {
    pluginOptions.push('tsconfigAliases: false');
  }

  const pluginCall = `SsrBoost({ ${pluginOptions.join(', ')} })`;

  if (config.plugin) {
    throw sourceError(
      config.file,
      config.plugin,
      'existing SsrBoost plugin with a SPA browser entry; finish configuration manually',
    );
  }

  if (config.plugins?.type === 'ArrayExpression') {
    edits.push({
      start: config.plugins.start! + 1,
      end: config.plugins.start! + 1,
      text: `${pluginCall}${config.plugins.elements.length ? ', ' : ''}`,
    });
  } else if (!config.plugins) {
    edits.push({
      start: config.node.start! + 1,
      end: config.node.start! + 1,
      text: `${newline}  plugins: [${pluginCall}],`,
    });
  } else {
    throw sourceError(config.file, config.plugins, 'Vite plugins; use an array literal');
  }

  if (namesIn(config.ast).has('SsrBoost')) {
    throw sourceError(
      config.file,
      undefined,
      'existing SsrBoost binding; rename it before automatic migration',
    );
  }

  add(
    config.file,
    `import SsrBoost from ${quote}${PLUGIN_NAME}/plugin${quote}${semicolon}${newline}${editText(config.code, edits)}`,
  );

  if (!html.outlets) {
    add(
      indexFile,
      editText(html.code, [
        {
          start: rootLocation.startTag!.endOffset,
          end: rootLocation.startTag!.endOffset,
          text: '<!--ssr-outlet-->',
        },
      ]),
    );
  }

  const packageFile = path.join(root, 'package.json');
  const packageCode = fs.readFileSync(packageFile, 'utf8');
  const pkg = readPackage(packageFile);
  const scripts: Record<string, string> = {
    ...pkg.scripts,
    [pkg.scripts && Object.hasOwn(pkg.scripts, 'dev') ? 'dev' : 'develop']: 'ssr-boost dev',
    build: 'ssr-boost build',
    'start:ssr': 'ssr-boost start',
  };

  if (pkg.scripts?.preview === 'vite preview') {
    scripts.preview = 'ssr-boost preview';
  }

  const packageFormat = format(packageCode);
  const version = libraryPackage().version!;
  const dependencies = {
    ...pkg.dependencies,
    [PLUGIN_NAME]:
      pkg.dependencies?.[PLUGIN_NAME] ?? pkg.devDependencies?.[PLUGIN_NAME] ?? `^${version}`,
  };

  // JSON keeps its indentation, line endings, key order, and unrelated fields.
  add(
    packageFile,
    `${JSON.stringify({ ...pkg, scripts, dependencies }, null, packageFormat.indent).replace(/\n/g, packageFormat.newline)}${packageCode.endsWith('\n') ? packageFormat.newline : ''}`,
  );

  return changes.sort((left, right) => left.file.localeCompare(right.file));
};

/** CLI default is a complete unified diff, with no temporary files or installs. */
const runInit = (options: IInitOptions = {}): void => {
  try {
    if (options.apply && options.dryRun) {
      throw new Error('Choose either --dry-run or --apply.');
    }

    const changes = planInit(options);

    if (!changes.length) {
      console.info('No changes: SSR is already initialized. Run ssr-boost doctor.');

      return;
    }

    for (const change of changes) {
      console.info(
        createTwoFilesPatch(
          change.before ? `a/${change.file}` : '/dev/null',
          `b/${change.file}`,
          change.before,
          change.after,
        ),
      );
    }

    if (options.apply) {
      for (const change of changes) {
        fs.writeFileSync(path.resolve(options.root ?? process.cwd(), change.file), change.after);
      }
    }

    console.info(
      options.apply
        ? `Applied ${changes.length} file changes.`
        : 'Dry run: no files written. Use --apply to write these changes.',
    );
    console.info('Next: npm install; then npx ssr-boost doctor.');
  } catch (error) {
    console.error(`${(error as Error).message}\nManual migration: ${MANUAL_GUIDE}`);
    process.exitCode = 1;
  }
};

export default runInit;
