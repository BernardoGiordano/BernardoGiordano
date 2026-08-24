import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

/**
 * Four things can drift apart, and the first three are each a silent 404 or a
 * load refusal: the srl entries pasted into index.html, the same entries in the
 * installed package, and the hashes of the files this repository vendors itself.
 *
 * The fourth is quieter and worse. Two copies of the library reach a browser —
 * `npm start` serves node_modules/@srljs/core, and `npm run build` bundles the
 * srl submodule's own source — so a version skew between them is a production
 * artifact running a framework the development server never ran.
 */

const ROOT = resolve(import.meta.dirname, '../..');
const failures = [];

const html = await readFile(join(ROOT, 'web/index.html'), 'utf8');
const block = /<script type="importmap">([\s\S]*?)<\/script>/u.exec(html);
if (block === null) throw new Error('web/index.html has no import map');
const pasted = JSON.parse(block[1]);

const srl = JSON.parse(await readFile(join(ROOT, 'node_modules/@srljs/core/lib/importmap.json'), 'utf8'));

for (const [specifier, target] of Object.entries(srl.imports)) {
  if (pasted.imports[specifier] !== target) {
    failures.push(`imports["${specifier}"] is ${String(pasted.imports[specifier])}, srl says ${target}`);
  }
}
for (const [path, hash] of Object.entries(srl.integrity)) {
  if (pasted.integrity[path] !== hash) {
    failures.push(`integrity["${path}"] is ${String(pasted.integrity[path])}, srl says ${hash}`);
  }
}

const installed = JSON.parse(await readFile(join(ROOT, 'node_modules/@srljs/core/package.json'), 'utf8'));
const submodule = await readJson(join(ROOT, 'srl/source/package.json'));
if (submodule !== null && submodule.version !== installed.version) {
  failures.push(`srl/source is ${submodule.version}, node_modules/@srljs/core is ${installed.version}`);
}

const provenance = JSON.parse(await readFile(join(ROOT, 'web/vendor/provenance.json'), 'utf8'));
for (const [name, entry] of Object.entries(provenance.files)) {
  const bytes = await readFile(join(ROOT, 'web/vendor', name));
  const actual = `sha384-${createHash('sha384').update(bytes).digest('base64')}`;
  if (actual !== entry.integrity) failures.push(`web/vendor/${name} hashes to ${actual}, provenance says ${entry.integrity}`);
  if (pasted.integrity[`/vendor/${name}`] !== entry.integrity) {
    failures.push(`integrity["/vendor/${name}"] disagrees with provenance.json`);
  }
}

if (failures.length > 0) {
  for (const line of failures) process.stderr.write(`${line}\n`);
  process.stderr.write(
    '\nRe-paste node_modules/@srljs/core/lib/importmap.json, run node tools/dev/vendor.mjs, ' +
      'or move the srl submodule to the commit that publishes the installed version.\n',
  );
  process.exit(1);
}
process.stdout.write('import map agrees with @srljs/core and web/vendor/provenance.json\n');

/**
 * A JSON file, or null when it is not there. Only srl/ is read this way: a
 * clone made without --recurse-submodules has an empty one, which is a checkout
 * that cannot build the production artifact rather than a version disagreement,
 * and `git submodule update --init` is the answer to it.
 *
 * @param {string} path
 */
async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return null;
    throw error;
  }
}
