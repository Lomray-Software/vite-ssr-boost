import fs from 'node:fs';

interface ISsrMetadata {
  routeFiles?: {
    // original => generated file
    [originalFileName: string]: string;
  };
}

/**
 * Return meta file path
 */
const getMetaFilepath = (buildDir: string): string => `${buildDir}/meta.json`;

/**
 * Write build metadata
 */
const writeMeta = (buildDir: string, data: ISsrMetadata): void => {
  const meta = readMeta(buildDir);

  fs.writeFileSync(getMetaFilepath(buildDir), JSON.stringify({ ...meta, ...data }, null, 2), {
    encoding: 'utf-8',
  });
};

/**
 * Read build metadata
 */
const readMeta = (buildDir: string): ISsrMetadata => {
  const metaFile = getMetaFilepath(buildDir);

  try {
    return JSON.parse(fs.readFileSync(metaFile, { encoding: 'utf-8' })) as ISsrMetadata;
  } catch (e) {
    // ignore, file not exist
  }

  return {};
};

/**
 * Remove metadata file
 */
const removeMeta = (buildDir: string): void => {
  try {
    fs.unlinkSync(getMetaFilepath(buildDir));
  } catch (e) {
    // ignore
  }
};

export { writeMeta, readMeta, removeMeta };
