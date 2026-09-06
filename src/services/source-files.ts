import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';
import type { File, Node, ObjectExpression, ImportDeclaration } from '@babel/types';
import { VISITOR_KEYS } from '@babel/types';
import type { Alias } from 'vite';

export interface ISourceValue {
  node: Node;
  file: string;
}

export interface ISourceFile {
  code: string;
  ast: File;
}

/** Strip syntax that has no runtime effect. */
export const unwrap = (node: Node | null | undefined): Node | undefined => {
  switch (node?.type) {
    case 'TSSatisfiesExpression':
    case 'TSAsExpression':
    case 'TSTypeAssertion':
    case 'TSNonNullExpression':
    case 'ParenthesizedExpression':
      return unwrap(node.expression);
    default:
      return node ?? undefined;
  }
};

/** Walk syntax without evaluating application code or following type metadata. */
export const walk = (node: Node, visit: (child: Node) => void): void => {
  visit(node);

  for (const key of VISITOR_KEYS[node.type] ?? []) {
    const value: unknown = Reflect.get(node, key);

    for (const child of Array.isArray(value) ? value : [value]) {
      if (child && typeof child === 'object' && 'type' in child) {
        walk(child as Node, visit);
      }
    }
  }
};

/** A single actionable error, including the original source location. */
export const sourceError = (file: string, node: Node | undefined, construct: string): Error =>
  new Error(
    `${file}:${node?.loc?.start.line ?? 1}:${(node?.loc?.start.column ?? 0) + 1}: Unsupported ${construct} (${node?.type ?? 'undefined'}).`,
  );

/** Property names whose meaning is known without executing an expression. */
export const propertyName = (node: ObjectExpression['properties'][number]): string | undefined => {
  if (node.type === 'SpreadElement') {
    return;
  }

  if (node.key.type === 'StringLiteral') {
    return node.key.value;
  }

  return !node.computed && node.key.type === 'Identifier' ? node.key.name : undefined;
};

/** Static module bindings shared by migration and route analysis. */
class SourceFiles {
  private readonly files = new Map<string, ISourceFile>();

  public constructor(private readonly aliases: Alias[] = []) {}

  public read(file: string): ISourceFile {
    const cached = this.files.get(file);

    if (cached) {
      return cached;
    }

    let code: string;

    try {
      code = fs.readFileSync(file, 'utf8');
    } catch {
      throw sourceError(file, undefined, 'missing source file');
    }

    try {
      const result = {
        code,
        ast: parse(code, {
          sourceType: 'module',
          createImportExpressions: true,
          plugins: ['typescript', 'jsx'],
        }),
      };

      this.files.set(file, result);

      return result;
    } catch (error) {
      // Babel includes the syntax location, but not the source filename.
      throw new Error(`${file}: ${String((error as Error).message)}`);
    }
  }

  public import(
    file: string,
    name: string,
  ): { source: string; exported: string; declaration: ImportDeclaration } | undefined {
    for (const node of this.read(file).ast.program.body) {
      if (node.type !== 'ImportDeclaration' || node.importKind === 'type') {
        continue;
      }

      const specifier = node.specifiers.find((item) => item.local.name === name);

      if (specifier?.type === 'ImportDefaultSpecifier') {
        return { source: node.source.value, exported: 'default', declaration: node };
      }

      if (specifier?.type === 'ImportSpecifier' && specifier.importKind !== 'type') {
        return {
          source: node.source.value,
          exported:
            specifier.imported.type === 'Identifier'
              ? specifier.imported.name
              : specifier.imported.value,
          declaration: node,
        };
      }
    }

    return undefined;
  }

  public filename(specifier: string, importer: string, node?: Node): string {
    let filename = specifier;

    for (const { find, replacement } of this.aliases) {
      if (
        typeof find === 'string'
          ? filename === find || filename.startsWith(`${find}/`)
          : find.test(filename)
      ) {
        filename = filename.replace(find, replacement);
        break;
      }
    }

    if (!path.isAbsolute(filename)) {
      if (!filename.startsWith('.')) {
        throw sourceError(importer, node, `unresolvable import ${JSON.stringify(specifier)}`);
      }

      filename = path.resolve(path.dirname(importer), filename);
    }

    for (const suffix of [
      '',
      '.js',
      '.ts',
      '.tsx',
      '.jsx',
      '.mjs',
      '.mts',
      '.cjs',
      '.cts',
      '/index.js',
      '/index.ts',
      '/index.tsx',
      '/index.jsx',
    ]) {
      const candidate = `${filename}${suffix}`;

      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    }

    throw sourceError(importer, node, `missing import ${JSON.stringify(specifier)}`);
  }

  public exported(file: string, name = 'default', seen = new Set<string>()): ISourceValue {
    const key = `${file}#export:${name}`;

    if (seen.has(key)) {
      throw sourceError(file, undefined, `circular export ${name}`);
    }

    seen.add(key);

    for (const node of this.read(file).ast.program.body) {
      if (node.type === 'ExportDefaultDeclaration' && name === 'default') {
        return this.resolve({ node: node.declaration, file }, seen);
      }

      if (node.type !== 'ExportNamedDeclaration') {
        continue;
      }

      if (node.declaration?.type === 'VariableDeclaration') {
        const declaration = node.declaration.declarations.find(
          (item) => item.id.type === 'Identifier' && item.id.name === name,
        );

        if (declaration?.init) {
          return this.resolve({ node: declaration.init, file }, seen);
        }
      }

      for (const specifier of node.specifiers) {
        const exported =
          specifier.exported.type === 'Identifier'
            ? specifier.exported.name
            : specifier.exported.value;

        if (exported === name && specifier.type === 'ExportSpecifier') {
          return node.source
            ? this.exported(
                this.filename(node.source.value, file, node),
                specifier.local.name,
                seen,
              )
            : this.resolve({ node: specifier.local, file }, seen);
        }
      }
    }

    throw sourceError(file, undefined, `missing export ${JSON.stringify(name)}`);
  }

  public resolve(value: ISourceValue, seen = new Set<string>()): ISourceValue {
    const { file } = value;
    const node = unwrap(value.node)!;

    if (node.type !== 'Identifier') {
      return { node, file };
    }

    const key = `${file}#${node.name}`;

    if (seen.has(key)) {
      throw sourceError(file, node, `circular binding ${node.name}`);
    }

    seen.add(key);

    const imported = this.import(file, node.name);

    if (imported) {
      return this.exported(this.filename(imported.source, file, node), imported.exported, seen);
    }

    for (const statement of this.read(file).ast.program.body) {
      const declaration =
        statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;

      if (declaration?.type === 'VariableDeclaration') {
        const binding = declaration.declarations.find(
          (item) => item.id.type === 'Identifier' && item.id.name === node.name,
        );

        if (binding?.init) {
          return this.resolve({ node: binding.init, file }, seen);
        }
      }

      if (declaration?.type === 'FunctionDeclaration' && declaration.id?.name === node.name) {
        return { node: declaration, file };
      }
    }

    throw sourceError(file, node, `unresolved binding ${node.name}`);
  }

  public properties(value: ISourceValue, ancestors = new Set<Node>()): Map<string, ISourceValue> {
    const { node, file } = this.resolve(value);

    if (node.type !== 'ObjectExpression' || ancestors.has(node)) {
      throw sourceError(file, node, 'route object / object spread; use a static object');
    }

    const next = new Set([...ancestors, node]);
    const properties = new Map<string, ISourceValue>();

    for (const property of node.properties) {
      if (property.type === 'SpreadElement') {
        for (const [name, entry] of this.properties({ node: property.argument, file }, next)) {
          properties.set(name, entry);
        }

        continue;
      }

      const name = propertyName(property);

      if (name === undefined) {
        throw sourceError(file, property, 'computed route key; use a string literal');
      }

      properties.set(name, {
        node: property.type === 'ObjectProperty' ? property.value : property,
        file,
      });
    }

    return properties;
  }
}

export default SourceFiles;
