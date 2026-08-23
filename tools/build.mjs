import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

/**
 * Assemble dist/ in the shape the import map already points at.
 *
 * There is no bundler and nothing is transpiled. What this does is the three
 * edits a production page needs and a development one must not have:
 *
 *   1. run the Tailwind CLI once over the sources, emitting app.css;
 *   2. swap index.html from the browser JIT script to that stylesheet;
 *   3. copy @srljs/core's lib/ and components/ to /lib/ and /components/, minus
 *      the development-only Tailwind bundle nothing in production loads.
 */

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const SRL = join(ROOT, 'node_modules/@srljs/core');

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });

const css = spawnSync(
  join(ROOT, 'node_modules/.bin/tailwindcss'),
  ['-i', join(ROOT, 'web/src/app.css'), '-o', join(ROOT, 'web/app.css'), '--minify'],
  { stdio: 'inherit' },
);
if (css.status !== 0) throw new Error('the Tailwind CLI failed');

await cp(join(ROOT, 'web'), DIST, { recursive: true });

let html = await readFile(join(DIST, 'index.html'), 'utf8');

const jit = /\n    <!-- Development: Tailwind[\s\S]*?><\/script>\n/u;
if (!jit.test(html)) throw new Error('index.html no longer has the development Tailwind block to remove');
html = html.replace(jit, '\n');

const theme = /\n    <style type="text\/tailwindcss">[\s\S]*?<\/style>\n/u;
if (!theme.test(html)) throw new Error('index.html no longer has the inline @theme block to remove');
html = html.replace(theme, '\n');

if (!html.includes('<!-- <link rel="stylesheet" href="/app.css" /> -->')) {
  throw new Error('index.html no longer has the commented production stylesheet link');
}
html = html.replace('<!-- <link rel="stylesheet" href="/app.css" /> -->', '<link rel="stylesheet" href="/app.css" />');

await writeFile(join(DIST, 'index.html'), html);
await rm(join(DIST, 'src/app.css'));

await cp(join(SRL, 'lib'), join(DIST, 'lib'), { recursive: true });
await cp(join(SRL, 'components'), join(DIST, 'components'), { recursive: true });
await rm(join(DIST, 'lib/vendor/tailwind-browser.js'));
await rm(join(DIST, 'lib/test'), { recursive: true, force: true });
await rm(join(DIST, 'components/test'), { recursive: true, force: true });

const stamp = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
await writeFile(
  join(DIST, 'build.json'),
  `${JSON.stringify({ commit: stamp.stdout.trim(), builtAt: new Date().toISOString() }, null, 2)}\n`,
);

process.stdout.write(`dist/ ready, commit ${stamp.stdout.trim()}\n`);
