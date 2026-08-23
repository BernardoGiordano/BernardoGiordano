import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, resolve, sep } from 'node:path';
import { transform } from 'esbuild';

/**
 * Assemble dist/ in the shape the import map already points at.
 *
 * There is no bundler and nothing is transpiled. What this does is the three
 * edits a production page needs and a development one must not have:
 *
 *   1. run the Tailwind CLI once over the sources, emitting app.css;
 *   2. swap index.html from the browser JIT script to that stylesheet;
 *   3. copy @srljs/core's lib/ and components/ to /lib/ and /components/, minus
 *      the development-only Tailwind bundle nothing in production loads;
 *   4. minify the JavaScript and CSS it is about to ship, and prove that the
 *      files it deliberately did not touch still hash to what index.html pins.
 *
 * Pass --no-minify to skip step 4 when a production-only fault has to be read in
 * the browser's own stack trace.
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

// Every path index.html pins a sha384 for. Both trees arrive minified from
// upstream, and rewriting one byte of either is not a smaller file, it is a
// module the browser refuses to execute.
const PINNED = /^(?:lib\/)?vendor\//u;

const paths = [];
for (const entry of await readdir(DIST, { recursive: true })) {
  const path = join(DIST, entry);
  if ((await stat(path)).isFile()) paths.push([entry.split(sep).join('/'), path]);
}

// Type declarations travel with the package and no browser ever asks for them.
for (const [url, path] of paths) {
  if (url.endsWith('.d.ts')) await rm(path);
}

if (!process.argv.includes('--no-minify')) {
  let before = 0;
  let after = 0;
  let count = 0;

  for (const [url, path] of paths) {
    if (url.endsWith('.d.ts')) continue;

    // A file at a time, and never bundled. The import map is the module graph:
    // a bundler would have to be taught the same bare specifiers the browser
    // already resolves, and srl derives a component's template URL from its own
    // import.meta.url, so the .js files have to keep their names and stay beside
    // the .html next to them.
    const loader = url.endsWith('.js') || url.endsWith('.mjs') ? 'js' : url.endsWith('.css') ? 'css' : null;
    if (loader === null) continue;

    // app.css came out of the Tailwind CLI above with --minify already.
    if (PINNED.test(url) || url === 'app.css') continue;

    const source = await readFile(path, 'utf8');
    // No format: 'esm'. It would let esbuild rename module-level names too,
    // which measured 648 bytes over 91 files — nothing, against a rename that
    // reaches anything reading a class or function by name at runtime.
    const { code } = await transform(source, { loader, minify: true, target: 'esnext' });
    await writeFile(path, code);

    before += Buffer.byteLength(source);
    after += Buffer.byteLength(code);
    count += 1;
  }

  const saved = Math.round(((before - after) / before) * 100);
  process.stdout.write(`minified ${count} files, ${Math.round(before / 1024)}K -> ${Math.round(after / 1024)}K (-${saved}%)\n`);
}

// The loop above skips two trees on purpose. This is what proves it did: a hash
// index.html pins and dist/ no longer matches is a blank page for whoever visits
// next and nothing at all in this job's output.
const pinned = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/u.exec(html)[1]).integrity;
for (const [url, expected] of Object.entries(pinned)) {
  const actual = `sha384-${createHash('sha384').update(await readFile(join(DIST, url.slice(1)))).digest('base64')}`;
  if (actual !== expected) throw new Error(`${url} hashes to ${actual}, index.html pins ${expected}`);
}
process.stdout.write(`${Object.keys(pinned).length} pinned files still match index.html\n`);

const stamp = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
await writeFile(
  join(DIST, 'build.json'),
  `${JSON.stringify({ commit: stamp.stdout.trim(), builtAt: new Date().toISOString() }, null, 2)}\n`,
);

process.stdout.write(`dist/ ready, commit ${stamp.stdout.trim()}\n`);
