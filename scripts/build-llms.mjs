import { execFileSync } from 'node:child_process';
import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const docs = new URL('docs/', root);
const dist = new URL('.vitepress/dist/', docs);
const site = 'https://lomray-software.github.io/vite-ssr-boost/';
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const readVersion = (command, args) => {
  try {
    return execFileSync(command, args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 30_000,
    }).trim();
  } catch {
    return '';
  }
};
const tagVersion = readVersion('git', ['describe', '--tags', '--match', 'v*', '--abbrev=0'])
  .replace(/^v/, '');
const version = tagVersion || readVersion('npm', ['view', pkg.name, 'version']);
const versionSource = tagVersion ? 'git describe' : 'npm view';
const files = (await readdir(docs, { recursive: true }))
  .filter((file) => file.endsWith('.md') && !file.split('/').some((part) => part.startsWith('.')))
  .sort();
const pages = [];
const skillNames = ['ssr-boost-migrate', 'ssr-boost-new-app'];
const skills = await Promise.all(skillNames.map(async (name) => {
  const file = `skills/${name}/SKILL.md`;
  const url = `https://github.com/Lomray-Software/vite-ssr-boost/blob/prod/${file}`;
  const source = await readFile(new URL(file, root), 'utf8');

  // Installed skills use relative supporting files; the concatenated document has no file base.
  const absoluteSource = source.replace(/\]\((?![a-z]+:|#|\/)([^)]+)\)/g,
    (_match, target) => `](${new URL(target, url).href})`);

  return { title: name, url, source: absoluteSource };
}));

for (const file of files) {
  const source = await readFile(new URL(file, docs), 'utf8');
  const html = file.replace(/\.md$/, '.html');
  const route = file.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '');
  const url = new URL(route, site).href;
  const title = source.match(/^# (.+)$/m)?.[1] ?? (file === 'index.md' ? 'Vite SSR BOOST' : route);

  // Keep clean URLs aligned with VitePress output, including nested index pages.
  try {
    await access(new URL(html, dist));
  } catch {
    throw new Error(`Missing built page for ${url}: ${html}`);
  }

  pages.push({ title, url, source });
}

const grounding = await readFile(new URL('ai-usage.md', docs), 'utf8');
const section = (heading) => {
  const content = grounding.split(`## ${heading}\n`)[1]?.split('\n## ')[0].trim();

  if (!content) {
    throw new Error(`Missing AI grounding section: ${heading}`);
  }

  // These source sections use site-root links; make them usable outside the docs site.
  return `## ${heading}\n\n${content.replace(/\]\(\/(?!\/)/g, `](${site}`)}`;
};
const introduction = [
  '# Vite SSR BOOST',
  `> ${pkg.description}`,
  `Package: \`${pkg.name}\``,
  ...(version ? [`Version: \`${version}\``] : []),
  section('Public entrypoints'),
  section('Data loading contract'),
].join('\n\n');
const index = `${introduction}\n\n## Documentation\n\n${pages
  .map(({ title, url }) => `- [${title}](${url})`)
  .join('\n')}\n\n## Agent skills\n\n${skills
  .map(({ title, url }) => `- [${title}](${url})`)
  .join('\n')}\n`;
const full = `${introduction}\n\n${[...pages, ...skills]
  .map(({ url, source }) => `---\n\nSource: ${url}\n\n${source.trim()}`)
  .join('\n\n')}\n`;

await writeFile(new URL('llms.txt', dist), index);
await writeFile(new URL('llms-full.txt', dist), full);

process.stdout.write(
  (version
    ? `Documentation version: ${version} (source: ${versionSource})\n`
    : 'Documentation version: omitted (git tags and npm registry unavailable)\n') +
    `llms.txt: ${pages.length} page links, ${Buffer.byteLength(index)} bytes\n` +
    `llms-full.txt: ${pages.length} concatenated pages, ${skills.length} skills, ${Buffer.byteLength(full)} bytes\n` +
    `Verified ${pages.length}/${pages.length} page links resolve in ${fileURLToPath(dist)}\n`,
);
