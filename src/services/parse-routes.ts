import fs from 'fs';
import { resolve } from 'node:path';
import path from 'path';
import * as parser from '@babel/parser';
import type { ParseResult } from '@babel/parser';
import babelTraverse from '@babel/traverse';
import type * as TraverseTypes from '@babel/traverse';
import type { CallExpression, File as BabelFile, VariableDeclaration } from '@babel/types';
import type { Alias } from 'vite';
import PathNormalize from '@services/path-normalize';
import type ServerConfig from '@services/server-config';

// @ts-expect-error known import problem
const traverse = (babelTraverse.default ?? babelTraverse) as (typeof TraverseTypes)['default'];

interface IPathImport {
  routesPath: string | null;
  exportName: string | null;
}

interface IMapImports {
  [name: string]: {
    path: string;
    isDefault: boolean; // is default import?
  };
}

export type TRoutesTree = {
  index: number;
  import: string;
  children: TRoutesTree[];
};

/**
 * Parse react router routes array
 */
class ParseRoutes {
  /**
   * Path normalize service
   */
  protected readonly pathNormalize: PathNormalize;

  /**
   * Server config
   */
  protected readonly config: ServerConfig;

  /**
   * @constructor
   */
  constructor(config: ServerConfig, viteAliases?: Alias[]) {
    this.config = config;
    this.pathNormalize = new PathNormalize(config, viteAliases);
  }

  /**
   * Parse routes
   */
  public parse(): TRoutesTree[] {
    const { clientFile, root } = this.config.getParams();

    const clientEntrypoint = resolve(root, clientFile);
    const routesEntrypoint = this.findRoutesEntrypoint(clientEntrypoint);

    if (!routesEntrypoint?.routesPath) {
      throw new Error(`Unable to find routes file import in ${clientFile}`);
    }

    const { routesPath, exportName } = routesEntrypoint;
    const routeFilepath = this.resolveFilename(routesPath);

    return this.recursiveBuildRoutesTree(routeFilepath, exportName);
  }

  /**
   * Parse file and return ast
   */
  private parseFile(filename: string): ParseResult<BabelFile> | null {
    try {
      const code = fs.readFileSync(filename, 'utf-8');

      return parser.parse(code, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx'],
      });
    } catch (e) {
      return null;
    }
  }

  /**
   * Find route import filepath
   */
  private getImportPath(
    ast: ParseResult<BabelFile>,
    importName: string | null,
  ): IPathImport | null {
    let routesPath: string | null = null;
    let exportName: string | null = null;

    traverse(ast, {
      ImportDeclaration(nodePath) {
        const importNode = nodePath.node;

        importNode.specifiers.forEach((specifier) => {
          if (specifier.local.name === importName) {
            exportName = specifier.type === 'ImportDefaultSpecifier' ? null : importName;
            routesPath = importNode.source.value;
          }
        });
      },
    });

    return {
      routesPath,
      exportName,
    };
  }

  /**
   * Find routes array inside code
   */
  private findRoutesDefinition(
    ast: ParseResult<BabelFile>,
    exportName: string | null,
  ): null | VariableDeclaration {
    let exportNameResolved = exportName;

    // noinspection JSUnusedGlobalSymbols
    traverse(ast, {
      ExportNamedDeclaration({ node }) {
        if (!node.declaration && node.specifiers.length > 0) {
          node.specifiers.forEach((specifier) => {
            // @ts-expect-error missing in types
            const exportedName = specifier.exported.name as string;

            if (exportName === null && specifier.type === 'ExportSpecifier') {
              if (specifier.local.name === 'default') {
                exportNameResolved = exportedName;
              }
            } else if (exportedName === exportName) {
              // @ts-expect-error missing in types
              // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
              exportNameResolved = specifier.local.name as string;
            }
          });
        }
      },
      ExportDefaultDeclaration({ node }) {
        if (exportName === null) {
          if (node.declaration.type === 'Identifier') {
            exportNameResolved = node.declaration.name;
            // @ts-expect-error missing in types
          } else if (node.declaration.type === 'VariableDeclaration') {
            // @ts-expect-error missing in types
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            exportNameResolved = node.declaration.declarations[0].id.name as string;
          }
        }
      },
    });

    if (exportNameResolved) {
      let variableNode: VariableDeclaration | null = null;

      traverse(ast, {
        VariableDeclaration({ node }) {
          node.declarations.forEach((declaration) => {
            // @ts-expect-error missing in types
            if (declaration.id.name === exportNameResolved) {
              variableNode = node;
            }
          });
        },
      });

      return variableNode;
    }

    return null;
  }

  /**
   * Entrypoint routes file
   */
  private findRoutesEntrypoint(clientEntrypoint: string): IPathImport | null {
    const ast = this.parseFile(clientEntrypoint);

    let routesVariable: string | null = null;

    if (!ast) {
      return routesVariable;
    }

    traverse(ast, {
      CallExpression({ node }) {
        if (
          // @ts-expect-error missing in types
          node.callee.name === 'entryClient' &&
          node.arguments.length >= 2 &&
          node.arguments[1].type === 'Identifier'
        ) {
          routesVariable = node.arguments[1].name;
        }
      },
    });

    return this.getImportPath(ast, routesVariable);
  }

  /**
   * Resolve route filename import
   */
  private resolveFilename(filename: string, relativeFile?: string): string | null {
    let resolvedFilename = filename;

    if ((filename.startsWith('./') || filename.startsWith('../')) && relativeFile) {
      resolvedFilename = path.resolve(path.dirname(relativeFile), filename);
    }

    const filepath = this.pathNormalize.getAppPath(resolvedFilename, true);

    return this.pathNormalize.findAppFile(filepath!);
  }

  /**
   * Parse ast array routes objects
   */
  private parseRoutesArray(
    elements: TraverseTypes.Node[],
    importsMap: IMapImports,
    relativeFile: string,
  ): TRoutesTree[] {
    const results: TRoutesTree[] = [];

    elements.forEach((node, index) => {
      if (node.type === 'ObjectExpression') {
        const routeInfo: TRoutesTree = { index, import: '', children: [] };

        node.properties.forEach((prop) => {
          const objectProp = prop as {
            key: { name: string };
            value: { type: string; elements: TraverseTypes.Node[] };
          };

          if (objectProp.key.name === 'children' && objectProp.value.type === 'ArrayExpression') {
            routeInfo.children = this.parseRoutesArray(
              objectProp.value.elements,
              importsMap,
              relativeFile,
            );
          }

          // async routes
          if (
            objectProp.key.name === 'lazy' &&
            objectProp.value.type === 'ArrowFunctionExpression'
          ) {
            // @ts-expect-error incorrect types
            const importCall = objectProp.value.body as CallExpression;

            if (importCall.type === 'CallExpression' && importCall.callee.type === 'Import') {
              const [importArg] = importCall.arguments;

              if (importArg.type === 'StringLiteral') {
                routeInfo.import = importArg.value;
              }
            }
          }

          // static routes: Component
          if (objectProp.key.name === 'Component' && objectProp.value.type === 'Identifier') {
            // @ts-expect-error incorrect types
            const importName = objectProp.value.name as string;
            const { path: importPath } = importsMap[importName] ?? {};

            if (importPath) {
              routeInfo.import = importPath;
            }
          }

          // static routes: element
          if (objectProp.key.name === 'element' && objectProp.value.type === 'JSXElement') {
            // @ts-expect-error incorrect types
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            const importName = objectProp.value?.openingElement?.name?.name as string;
            const { path: importPath } = importsMap[importName] ?? {};

            if (importPath) {
              routeInfo.import = importPath;
            }
          }

          if (objectProp.key.name === 'children' && objectProp.value.type === 'Identifier') {
            // @ts-expect-error incorrect types
            const importName = objectProp.value.name as string;
            const { path: importPath, isDefault } = importsMap[importName] ?? {};

            if (importPath) {
              const childrenFilePath = this.resolveFilename(importPath, relativeFile);

              if (childrenFilePath) {
                routeInfo.children = this.recursiveBuildRoutesTree(
                  childrenFilePath,
                  isDefault ? null : importName,
                );
              }
            }
          }
        });

        if (routeInfo.import || routeInfo.children.length > 0) {
          results.push(routeInfo);
        }
      }
    });

    return results;
  }

  /**
   * Recursive build routes tree with dynamic imports
   */
  private recursiveBuildRoutesTree(
    filename: string | null,
    exportName: string | null = null,
  ): TRoutesTree[] {
    if (!filename) {
      return [];
    }

    const ast = this.parseFile(filename);

    if (!ast) {
      return [];
    }

    const routesNode = this.findRoutesDefinition(ast, exportName);
    const results: TRoutesTree[] = [];

    if (!routesNode) {
      return results;
    }

    const importsMap: IMapImports = {};

    traverse(ast, {
      ImportDeclaration(nodePath) {
        const importNode = nodePath.node;

        importNode.specifiers.forEach((specifier) => {
          importsMap[specifier.local.name] = {
            path: importNode.source.value,
            isDefault: specifier.type === 'ImportDefaultSpecifier',
          };
        });
      },
    });

    // @ts-expect-error missing types
    const elements = routesNode.declarations[0].init?.elements as TraverseTypes.Node[];

    results.push(...this.parseRoutesArray(elements, importsMap, filename));

    return results;
  }
}

export default ParseRoutes;
