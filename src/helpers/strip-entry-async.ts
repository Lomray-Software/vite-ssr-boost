import path from 'node:path';

/**
 * Escape a literal so a regular expression matches it character for character.
 */
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Remove async from the client entry script, so plugin preambles run before it.
 */
const stripEntryAsync = (html: string, base: string | undefined, clientFile: string): string => {
  const clientFileEntry = escapeRegExp(path.posix.normalize(`${base}/${clientFile}`));

  return html.replace(
    new RegExp(
      String.raw`<script[^>]*?\bsrc=["']/?${clientFileEntry}([^"']*)["'][^>]*?\sasync\b`,
      'g',
    ),
    (match) => match.replace(/\sasync\b/, ''),
  );
};

export default stripEntryAsync;
