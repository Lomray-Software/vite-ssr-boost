import fs from 'node:fs';
import path from 'path';
import type { Alias } from 'vite';
import type ServerConfig from '@services/server-config';

/**
 * Service for work with path and aliases
 */
class PathNormalize {
  /**
   * Vite resolve aliases
   */
  protected readonly viteAliases?: Alias[];

  /**
   * Server config
   */
  protected readonly config: ServerConfig;

  /**
   * @constructor
   */
  constructor(config: ServerConfig, viteAliases?: Alias[]) {
    this.config = config;
    this.viteAliases = viteAliases ?? config.getVite()?.config?.resolve.alias;
  }

  /**
   * Get vite aliases
   */
  public getAliases(): Record<string, string> {
    const aliases: Record<string, string> = {};

    this.viteAliases?.forEach(({ find, replacement }) => {
      if (typeof find !== 'string') {
        return;
      }

      aliases[find] = replacement;
    });

    return aliases;
  }

  /**
   * Return filename postfix
   */
  public getImportPostfix(): string[] {
    return ['', '/index']
      .map((prefix) => ['', '.js', '.ts', '.tsx'].map((ext) => `${prefix}${ext}`))
      .flat();
  }

  /**
   * Resolve app path
   */
  public getAppPath(appPath?: string, withRoot = false): string | undefined {
    if (!appPath) {
      return;
    }

    const { root } = this.config.getParams();
    let fullPath = appPath;

    // relative import
    if (appPath.startsWith('./') || appPath.startsWith('../')) {
      fullPath = path.resolve(root, appPath);
    } else {
      // alias import
      const aliases = this.getAliases();
      // get alias
      const [routeAlias] = appPath.split('/');

      if (aliases[routeAlias]) {
        fullPath = appPath.replace(routeAlias, aliases[routeAlias]);
      }
    }

    // normalize slashes
    fullPath = fullPath.split(path.win32.sep).join(path.posix.sep);

    if (withRoot) {
      return fullPath;
    }

    return fullPath.replace(root, '').replace(/^(\/)|(\/)$/g, '');
  }

  /**
   * Find app filepath
   */
  public findAppFile(basePath: string): string | null {
    const postfixes = this.getImportPostfix();

    for (const postfix of postfixes) {
      const filepath = `${basePath}${postfix}`;

      if (fs.existsSync(filepath) && fs.statSync(filepath).isFile()) {
        return filepath;
      }
    }

    return null;
  }
}

export default PathNormalize;
