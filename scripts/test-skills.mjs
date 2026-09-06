import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, chmod, cp, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const names = ['ssr-boost-migrate', 'ssr-boost-new-app'];
const allowed = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);
const frontmatter = (source, directory) => {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  assert.ok(match, `${directory}: missing YAML frontmatter`);
  const document = parseDocument(match[1], { uniqueKeys: true });
  assert.equal(document.errors.length, 0, `${directory}: ${document.errors.join('; ')}`);
  const data = document.toJS();
  assert.ok(data && typeof data === 'object' && !Array.isArray(data), `${directory}: expected mapping`);
  for (const key of Object.keys(data)) assert.ok(allowed.has(key), `${directory}: unsupported ${key}`);
  assert.equal(typeof data.name, 'string', 'name must be a string');
  assert.ok(data.name.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.name), 'invalid name');
  assert.equal(data.name, directory, 'name must match its directory');
  assert.equal(typeof data.description, 'string', 'description must be a string');
  assert.ok(data.description.trim().length > 0 && data.description.length <= 1024, 'invalid description');
  for (const key of ['license', 'compatibility', 'allowed-tools']) {
    if (key in data) assert.equal(typeof data[key], 'string', `${key} must be a string`);
  }
  if ('compatibility' in data) assert.ok(data.compatibility.length > 0 && data.compatibility.length <= 500);
  if ('metadata' in data) {
    assert.ok(data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata));
    assert.ok(Object.values(data.metadata).every((value) => typeof value === 'string'), 'metadata values must be strings');
  }
  assert.ok(source.slice(match[0].length).trim(), `${directory}: empty procedure`);
  return data;
};

// Validate Markdown destinations, including reference-style definitions and autolinks.
// Fenced code is excluded; code-font bundled file references are checked separately below.
const destinations = (source) => {
  const prose = source.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, '');
  return [
    ...prose.matchAll(/\]\(<?([^\s)>]+)>?(?:\s+["'][^\n]*?["'])?\)/g),
    ...prose.matchAll(/^\s*\[[^\]]+\]:\s*<?([^\s>]+)>?/gm),
    ...prose.matchAll(/<(https?:\/\/[^>]+)>/g),
  ].map((match) => match[1]);
};
const resolveTarget = (target, sourceFile) => {
  const clean = decodeURIComponent(target.split(/[?#]/)[0]);
  if (!clean || /^(?:mailto|app):/.test(clean)) return null;
  if (/^https?:/.test(clean)) {
    const repo = 'https://github.com/Lomray-Software/vite-ssr-boost/blob/prod/';
    const site = 'https://lomray-software.github.io/vite-ssr-boost/';
    if (clean.startsWith(repo)) return path.join(root, clean.slice(repo.length));
    if (clean.startsWith(site)) {
      const route = clean.slice(site.length).replace(/\/$/, '/index') || 'index';
      if (/^llms(?:-full)?\.txt$/.test(route)) return null; // Generated after docs build.
      return path.join(root, 'docs', `${route}.md`);
    }
    return null;
  }
  if (clean.startsWith('/')) return path.join(root, 'docs', `${clean.slice(1).replace(/\/$/, '/index') || 'index'}.md`);
  const file = path.resolve(path.dirname(sourceFile), clean);
  if (path.extname(file)) return file;
  return path.join(file, 'index.md');
};
const mustExist = async (file, from) => {
  const relative = path.relative(root, file);
  assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative), `${from}: reference escapes repository: ${file}`);
  try { await access(file); } catch { assert.fail(`${from}: missing referenced file ${relative}`); }
};

// Regression cases prove invalid metadata cannot pass through a permissive YAML parse.
for (const [key, value] of [
  ['name', 'Bad-Name'], ['name', '-bad'], ['name', 'bad--name'], ['name', 'a'.repeat(65)],
  ['description', '""'], ['description', '42'], ['description', 'x'.repeat(1025)],
]) {
  const fields = { name: 'example', description: 'Use for an example task.', [key]: value };
  assert.throws(() => frontmatter(`---\nname: ${fields.name}\ndescription: ${fields.description}\n---\nBody`, fields.name));
}
assert.throws(() => frontmatter('---\nname: example\nname: example\ndescription: ok\n---\nBody', 'example'));
assert.throws(() => frontmatter('---\nname: example\ndescription: ok\nmetadata: { version: 1 }\n---\nBody', 'example'));
frontmatter('---\nname: example\ndescription: >-\n  An example\n  task procedure.\n---\nBody', 'example');
await assert.rejects(mustExist(path.join(root, 'docs/not-a-real-skill-page.md'), 'regression'));
assert.deepEqual(destinations('[inline](references/a.md)\n[ref]: docs/guide/b.md\n<https://example.com>'),
  ['references/a.md', 'docs/guide/b.md', 'https://example.com']);

let links = 0;
const skillMarkdown = [];
for (const name of names) {
  const folder = path.join(root, 'skills', name);
  frontmatter(await readFile(path.join(folder, 'SKILL.md'), 'utf8'), name);
  const files = await readdir(folder, { recursive: true });
  for (const file of files.filter((name) => name.endsWith('.md'))) skillMarkdown.push(path.join(folder, file));
  for (const file of files.filter((name) => name.endsWith('.mjs'))) {
    execFileSync(process.execPath, ['--check', path.join(folder, file)], { stdio: 'pipe' });
  }
  for (const file of files.filter((name) => name.endsWith('.ts.txt'))) {
    const result = ts.transpileModule(await readFile(path.join(folder, file), 'utf8'), {
      fileName: file.replace(/\.txt$/, ''),
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      reportDiagnostics: true,
    });
    assert.equal(result.diagnostics.filter((item) => item.category === ts.DiagnosticCategory.Error).length,
      0, `${name}/${file}: invalid TypeScript template`);
  }
  const verify = path.join(folder, 'scripts/verify.sh');
  assert.ok((await stat(verify)).mode & 0o111, `${name}: verify.sh must be executable`);
  execFileSync('bash', ['-n', verify]);
  const temporary = await mkdtemp(path.join(tmpdir(), 'ssr skill validation '));
  try {
    await cp(folder, path.join(temporary, name), { recursive: true });
    // Any Node/npm/CLI call in help/dry mode fails, even if an implementation swallows its exit.
    const marker = path.join(temporary, 'unexpected-command');
    for (const command of ['node', 'npm', 'npx', 'ssr-boost']) {
      const trap = path.join(temporary, command);
      await writeFile(trap, '#!/bin/sh\nprintf called > "$SKILL_TEST_MARKER"\nexit 91\n');
      await chmod(trap, 0o755);
    }
    const options = {
      cwd: temporary,
      env: { ...process.env, PATH: `${temporary}:${process.env.PATH}`, SKILL_TEST_MARKER: marker },
      encoding: 'utf8', stdio: 'pipe', timeout: 10_000,
    };
    const copied = path.join(temporary, name, 'scripts/verify.sh');
    assert.match(execFileSync('bash', [copied, '--help'], options), /Usage:/);
    const dry = execFileSync('bash', [copied, '--dry-run', 'nonexistent app'], options);
    assert.match(dry, /doctor --json[\s\S]*build[\s\S]*size[\s\S]*smoke[\s\S]*build/);
    assert.ok(!(await readdir(temporary)).includes('nonexistent app'), 'dry mode created a project');
    await assert.rejects(access(marker), 'help/dry mode executed a project command');
    assert.throws(() => execFileSync('bash', [copied, '--unknown'], options));
    console.info(`${name}: frontmatter, standalone --help / --dry-run and shell syntax passed`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

const docFiles = (await readdir(path.join(root, 'docs'), { recursive: true }))
  .filter((file) => file.endsWith('.md') && !file.split('/').some((part) => part.startsWith('.')))
  .map((file) => path.join(root, 'docs', file));
for (const file of [...skillMarkdown, path.join(root, 'README.md'), ...docFiles]) {
  const source = await readFile(file, 'utf8');
  const isSkill = skillMarkdown.includes(file);
  for (const target of destinations(source)) {
    const resolved = resolveTarget(target, file);
    if (!resolved) continue;
    // All skill links must resolve; elsewhere this gate owns links into docs/.
    if (isSkill || resolved.startsWith(`${path.join(root, 'docs')}${path.sep}`)) {
      await mustExist(resolved, path.relative(root, file));
      links++;
    }
  }
  if (isSkill) {
    const folder = path.join(root, 'skills', path.relative(path.join(root, 'skills'), file).split(path.sep)[0]);
    for (const [, target] of source.matchAll(/`((?:references|scripts|assets)\/[\w./-]+\.(?:md|sh|mjs))`/g)) {
      // Backticked scripts/*.mjs often describe the target app. Bundled files are Markdown links.
      if (target.startsWith('references/')) await mustExist(path.join(folder, target), file);
    }
  }
}
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const plugin = JSON.parse(await readFile(path.join(root, '.claude-plugin/plugin.json'), 'utf8'));
const marketplace = JSON.parse(await readFile(path.join(root, '.claude-plugin/marketplace.json'), 'utf8'));
assert.equal(plugin.name, 'ssr-boost');
assert.equal(plugin.version, pkg.version);
assert.ok(plugin.description?.trim());
assert.deepEqual(plugin.skills, names.map((name) => `./skills/${name}`));
assert.equal(marketplace.name, 'lomray');
assert.ok(marketplace.owner.name);
assert.equal(marketplace.plugins.length, 1);
assert.equal(marketplace.plugins[0].name, plugin.name);
assert.equal(marketplace.plugins[0].source, './');
console.info(`Validated ${names.length} skills, ${links} local/doc links, plugin version ${plugin.version} and ssr-boost@lomray marketplace.`);
