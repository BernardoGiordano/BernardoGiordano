import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

/**
 * Three things can drift apart and each one is a silent 404 or a load refusal:
 * the srl entries pasted into index.html, the same entries in the installed
 * package, and the hashes of the files this repository vendors itself.
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
  process.stderr.write('\nRe-paste node_modules/@srljs/core/lib/importmap.json, or run node tools/dev/vendor.mjs.\n');
  process.exit(1);
}
process.stdout.write('import map agrees with @srljs/core and web/vendor/provenance.json\n');
