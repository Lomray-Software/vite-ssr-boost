import htmlEscape from '@helpers/html-escape';

/** Escape an attribute independently of the JavaScript string escaping rules. */
const script = (content: string, nonce?: string, isTemporary = false): string => {
  const attribute =
    nonce === undefined
      ? ''
      : ` nonce="${nonce.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)}"`;

  return `<script async${attribute}>${content}${isTemporary ? 'document.currentScript?.remove();' : ''}</script>`;
};

/** Queue frames even when the async browser entry has not executed yet. */
const streamScript = (frame: unknown, nonce?: string): string =>
  script(
    `(window.__ssrBoostStream = window.__ssrBoostStream || []).push(${htmlEscape(JSON.stringify(frame))});`,
    nonce,
    true,
  );

export { streamScript };

export default script;
