import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

/** Re-copy the vendored browser bundles from node_modules and restamp their hashes. */

const ROOT = resolve(import.meta.dirname, '../..');
const provenancePath = join(ROOT, 'web/vendor/provenance.json');
const provenance = JSON.parse(await readFile(provenancePath, 'utf8'));

const replacements = new Map();

for (const [name, entry] of Object.entries(provenance.files)) {
  const target = join(ROOT, 'web/vendor', name);
  await copyFile(join(ROOT, entry.from), target);

  const installed = JSON.parse(await readFile(join(ROOT, 'node_modules', entry.package, 'package.json'), 'utf8'));
  const hash = `sha384-${createHash('sha384').update(await readFile(target)).digest('base64')}`;

  if (entry.integrity !== hash) replacements.set(entry.integrity, hash);
  entry.version = installed.version;
  entry.integrity = hash;
  process.stdout.write(`${name} ${installed.version} ${hash}\n`);
}

await writeFile(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);

if (replacements.size > 0) {
  const htmlPath = join(ROOT, 'web/index.html');
  let html = await readFile(htmlPath, 'utf8');
  for (const [from, to] of replacements) html = html.replaceAll(from, to);
  await writeFile(htmlPath, html);
  process.stdout.write('web/index.html hashes updated\n');
}
