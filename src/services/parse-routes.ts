import path from 'node:path';
import babelGenerate from '@babel/generator';
import type * as GenerateTypes from '@babel/generator';
import * as parser from '@babel/parser';
import type { ParseResult } from '@babel/parser';
import babelTraverse from '@babel/traverse';
import type * as TraverseTypes from '@babel/traverse';
import type {
  Expression,
  Node as BabelNode,
  File as BabelFile,
  ObjectExpression,
} from '@babel/types';
import {
  isObjectProperty,
  isIdentifier,
  identifier,
  isBooleanLiteral,
  stringLiteral,
  isFunction,
  objectProperty,
  isArrayExpression,
  isJSXElement,
  isJSXIdentifier,
  isObjectExpression,
} from '@babel/types';
import type { Alias } from 'vite';
import PLUGIN_NAME from '@constants/plugin-name';
import type ServerConfig from '@services/server-config';
import SourceFiles, { unwrap, walk, propertyName, sourceError } from '@services/source-files';
import type { ISourceValue } from '@services/source-files';

// @ts-expect-error known import problem
const generate = (babelGenerate.default ?? babelGenerate) as (typeof GenerateTypes)['default'];
// @ts-expect-error known import problem
const traverse = (babelTraverse.default ?? babelTraverse) as (typeof TraverseTypes)['default'];

interface IMapImports {
  [name: string]: { path: string; isDefault: boolean };
}

export type TRoutesTree = {
  index: number;
  id?: string;
  path?: string | null;
  import: string;
  children: TRoutesTree[];
};

/** Get the one statically named module loaded by a lazy route. */
export const lazyImport = ({ node, file }: ISourceValue): string => {
  const value = unwrap(node)!;

  if (value.type !== 'ArrowFunctionExpression' && value.type !== 'FunctionExpression') {
    throw sourceError(file, value, 'lazy route; use a function importing one literal module');
  }

  let result = unwrap(value.body);

  if (result?.type === 'BlockStatement') {
    if (result.body.length !== 1 || result.body[0].type !== 'ReturnStatement') {
      throw sourceError(
        file,
        value,
        'lazy function body; return one literal import (optionally with .then)',
      );
    }

    result = unwrap(result.body[0].argument);
  }

  if (result?.type === 'AwaitExpression') {
    result = unwrap(result.argument);
  }

  if (
    result?.type === 'CallExpression' &&
    result.callee.type === 'MemberExpression' &&
    result.callee.property.type === 'Identifier' &&
    result.callee.property.name === 'then'
  ) {
    result = unwrap(result.callee.object);
  }

  if (result?.type !== 'ImportExpression') {
    throw sourceError(
      file,
      result,
      'lazy route result; return one literal import (optionally with .then)',
    );
  }

  const imports: string[] = [];

  walk(value, (child) => {
    // Babel 7 and 8 both use ImportExpression with createImportExpressions enabled.
    if (child.type === 'ImportExpression') {
      if (child.source.type !== 'StringLiteral') {
        throw sourceError(file, child, 'dynamic lazy import; use a string literal');
      }

      imports.push(child.source.value);
    }
  });

  if (imports.length !== 1) {
    throw sourceError(
      file,
      value,
      `lazy route with ${imports.length} imports; use exactly one literal module`,
    );
  }

  return imports[0];
};

/** Static React Router route analysis; never imports application code. */
class ParseRoutes {
  private static unwrapExpression = unwrap;

  public constructor(
    private readonly config: ServerConfig,
    private readonly viteAliases?: Alias[],
  ) {}

  /** Locate the library entry by its import binding, not its local spelling. */
  public parse(includeEmpty = false): TRoutesTree[] {
    const { clientFile, root } = this.config.getParams();
    const file = path.resolve(root, clientFile);
    const sources = new SourceFiles(
      this.viteAliases ?? this.config.getVite()?.config.resolve.alias,
    );
    const calls: ISourceValue[] = [];

    walk(sources.read(file).ast, (node) => {
      if (node.type !== 'CallExpression' || node.callee.type !== 'Identifier') {
        return;
      }

      const imported = sources.import(file, node.callee.name);

      if (
        imported?.source.replace(/\.js$/, '') === `${PLUGIN_NAME}/browser/entry` &&
        ['default', 'entry'].includes(imported.exported)
      ) {
        if (!node.arguments[1]) {
          throw sourceError(file, node, 'browser entry routes argument');
        }

        calls.push({ node: node.arguments[1], file });
      }
    });

    if (calls.length !== 1) {
      throw sourceError(
        file,
        calls[1]?.node,
        `browser entry calls (${calls.length}); expected one library browser/entry call`,
      );
    }

    return this.parseValue(sources, calls[0], includeEmpty);
  }

  /** Also used to validate a proposed migration before any files are written. */
  public parseValue(
    sources: SourceFiles,
    value: ISourceValue,
    includeEmpty = false,
    ancestors = new Set<BabelNode>(),
  ): TRoutesTree[] {
    const { node, file } = sources.resolve(value);

    if (node.type !== 'ArrayExpression' || ancestors.has(node)) {
      throw sourceError(file, node, 'routes array; use a static, non-circular array');
    }

    const next = new Set([...ancestors, node]);
    const results: TRoutesTree[] = [];

    node.elements.forEach((element, index) => {
      if (!element) {
        throw sourceError(file, node, 'empty route array entry; use route objects');
      }

      if (element.type === 'SpreadElement') {
        throw sourceError(file, element, 'route array spread; declare array entries explicitly');
      }

      const properties = sources.properties({ node: element, file });
      const route: TRoutesTree = { index, import: '', children: [] };
      const id = properties.get('id');
      const routePath = properties.get('path');
      const children = properties.get('children');
      const lazy = properties.get('lazy');

      if (id) {
        const resolved = sources.resolve(id);

        if (resolved.node.type !== 'StringLiteral') {
          throw sourceError(resolved.file, resolved.node, 'route id; use a static string');
        }

        route.id = resolved.node.value;
      }

      if (routePath) {
        // Dynamic path helpers do not affect asset analysis. Do not execute them for bundles.
        const literal = unwrap(routePath.node);

        route.path = literal?.type === 'StringLiteral' ? literal.value : null;
      }

      if (children) {
        route.children = this.parseValue(sources, children, includeEmpty, next);
      }

      if (lazy) {
        const resolved = sources.resolve(lazy);

        route.import = this.assetPath(lazyImport(resolved), resolved.file);
      } else {
        const component = properties.get('Component') ?? properties.get('element');
        const componentNode = unwrap(component?.node);
        const name =
          componentNode?.type === 'Identifier'
            ? componentNode.name
            : componentNode?.type === 'JSXElement' &&
                componentNode.openingElement.name.type === 'JSXIdentifier'
              ? componentNode.openingElement.name.name
              : undefined;
        const imported = component && name ? sources.import(component.file, name) : undefined;

        if (imported) {
          route.import = this.assetPath(imported.source, component!.file);
        } else if (component) {
          // Inline components and elements still belong to this module's asset graph.
          route.import = component.file;
        }
      }

      if (includeEmpty || route.import || route.children.length) {
        results.push(route);
      }
    });

    return results;
  }

  private assetPath(specifier: string, file: string): string {
    return specifier.startsWith('.') ? path.resolve(path.dirname(file), specifier) : specifier;
  }

  private static parseImportsMap(ast: ParseResult<BabelFile>): IMapImports {
    const imports: IMapImports = {};

    for (const node of ast.program.body) {
      if (node.type === 'ImportDeclaration') {
        for (const specifier of node.specifiers) {
          imports[specifier.local.name] = {
            path: node.source.value,
            isDefault: specifier.type === 'ImportDefaultSpecifier',
          };
        }
      }
    }

    return imports;
  }

  /**
   * Add pathId to static routes
   */
  private static processRouteFileCode(
    nodePath: TraverseTypes.NodePath<ObjectExpression>,
    importsMap: IMapImports,
    shouldAddPathId: boolean,
    addImportRouteWrapper: () => void,
    filename: string,
    wrapperName: string,
  ): void {
    nodePath.node.properties.forEach((property) => {
      if (isObjectProperty(property)) {
        const key = propertyName(property);

        // async routes
        if (key === 'lazy' && isFunction(unwrap(property.value))) {
          const lazyValue = unwrap(property.value)!;
          const importPath = lazyImport({ node: lazyValue, file: filename });
          const onlyClientProp = nodePath.node.properties.find(
            (p) => isObjectProperty(p) && propertyName(p) === 'onlyClient',
          );

          /**
           * Wrap lazy import with:
           * @see importRoute
           */
          property.value = {
            type: 'CallExpression',
            callee: {
              type: 'Identifier',
              name: wrapperName,
            },
            arguments:
              isObjectProperty(onlyClientProp) &&
              (isBooleanLiteral(onlyClientProp.value) ||
                isJSXElement(onlyClientProp.value) ||
                isFunction(onlyClientProp.value) ||
                isIdentifier(onlyClientProp.value))
                ? [property.value as Expression, onlyClientProp.value]
                : [property.value as Expression],
          };

          if (onlyClientProp) {
            nodePath.node.properties = nodePath.node.properties.filter((p) => p !== onlyClientProp);
          }

          addImportRouteWrapper();

          if (importPath) {
            // current object has part of array (inside array)
            const parent = nodePath.findParent?.((p) =>
              isArrayExpression(ParseRoutes.unwrapExpression(p.node)),
            );

            if (parent && importPath && shouldAddPathId) {
              const pathIdProperty = objectProperty(
                identifier('pathId'),
                stringLiteral(
                  importPath.startsWith('.') && path.isAbsolute(filename)
                    ? path.resolve(path.dirname(filename), importPath)
                    : importPath,
                ),
              );

              // Insert the pathId property right after the element property
              nodePath.node.properties.splice(
                nodePath.node.properties.indexOf(property) + 1,
                0,
                pathIdProperty,
              );
            }
          }
        }

        if (key === 'element' || key === 'Component') {
          let componentName = '';

          if (isJSXElement(property.value) && isJSXIdentifier(property.value.openingElement.name)) {
            componentName = property.value.openingElement.name.name;
          } else if (isIdentifier(property.value)) {
            componentName = property.value.name;
          }

          // current object has part of array (inside array)
          const parent = nodePath.findParent?.((p) =>
            isArrayExpression(ParseRoutes.unwrapExpression(p.node)),
          );
          const importName = importsMap[componentName]?.path;

          if (parent && importName && shouldAddPathId) {
            const pathIdProperty = objectProperty(
              identifier('pathId'),
              stringLiteral(
                importName.startsWith('.') && path.isAbsolute(filename)
                  ? path.resolve(path.dirname(filename), importName)
                  : importName,
              ),
            );

            // Insert the pathId property right after the element property
            nodePath.node.properties.splice(
              nodePath.node.properties.indexOf(property) + 1,
              0,
              pathIdProperty,
            );
          }
        }

        const children = ParseRoutes.unwrapExpression(property.value);

        if (key === 'children' && isArrayExpression(children)) {
          // Process each object in the children array recursively
          children.elements.forEach((element) => {
            if (isObjectExpression(element)) {
              ParseRoutes.processRouteFileCode(
                { node: element } as TraverseTypes.NodePath<ObjectExpression>,
                importsMap,
                shouldAddPathId,
                addImportRouteWrapper,
                filename,
                wrapperName,
              );
            }
          });
        }
      }
    });
  }

  /**
   * Inject pathId to sync/async routes
   * Add async wrapper (see import-routes)
   */
  public static handleRoutes(code: string, shouldAddPathId: boolean, filename = 'routes'): string {
    if (!code) {
      return code;
    }

    const ast = parser.parse(code, {
      sourceType: 'module',
      createImportExpressions: true,
      plugins: ['typescript', 'jsx'],
    });

    if (!ast) {
      return code;
    }

    const importsMap = ParseRoutes.parseImportsMap(ast);
    let shouldAddRoutesImport = false;
    let wrapperName = 'n';

    traverse(ast, {
      Program(nodePath) {
        if (nodePath.scope.hasBinding(wrapperName)) {
          wrapperName = nodePath.scope.generateUidIdentifier('importRoute').name;
        }
      },
    });

    traverse(ast, {
      ObjectExpression(nodePath): void {
        ParseRoutes.processRouteFileCode(
          nodePath,
          importsMap,
          shouldAddPathId,
          () => {
            shouldAddRoutesImport = true;
          },
          filename,
          wrapperName,
        );
      },
    });

    if (shouldAddRoutesImport) {
      ast.program.body.unshift({
        type: 'ImportDeclaration',
        specifiers: [
          {
            type: 'ImportDefaultSpecifier',
            local: {
              type: 'Identifier',
              name: wrapperName,
            },
          },
        ],
        source: {
          type: 'StringLiteral',
          value: `${PLUGIN_NAME}/helpers/import-route`,
        },
      });
    }

    return generate(ast, {
      retainLines: true,
    }).code;
  }
}

export default ParseRoutes;
