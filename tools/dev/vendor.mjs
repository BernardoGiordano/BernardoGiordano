import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

/**
 * Re-copy the vendored browser assets from node_modules and restamp their hashes.
 *
 * Two trees, one rule: nothing the browser fetches comes from a second origin.
 * `web/vendor/` is the modules the import map pins with an integrity hash, so a
 * changed hash has to be written back into `index.html` as well. `web/fonts/` is
 * Inter, which the stylesheet reaches by name and no document names — its hashes
 * are recorded so a silent change in the package is visible in a diff, not
 * because anything enforces them.
 */

const ROOT = resolve(import.meta.dirname, '../..');

/** @param {string} path */
const sha384 = async (path) => `sha384-${createHash('sha384').update(await readFile(path)).digest('base64')}`;

/**
 * Copy every file a provenance manifest lists, restamp its hash and size, and
 * report the hashes that changed.
 *
 * @param {string} dir directory under `web/`, holding the files and their `provenance.json`
 * @returns {Promise<Map<string, string>>} old hash to new hash, for the ones that moved
 */
async function refresh(dir) {
  const provenancePath = join(ROOT, 'web', dir, 'provenance.json');
  const provenance = JSON.parse(await readFile(provenancePath, 'utf8'));
  const replacements = new Map();

  for (const [name, entry] of Object.entries(provenance.files)) {
    const target = join(ROOT, 'web', dir, name);
    await copyFile(join(ROOT, entry.from), target);

    const hash = await sha384(target);
    if (entry.integrity !== hash) replacements.set(entry.integrity, hash);
    entry.integrity = hash;

    // A per-file package is stamped per file; one package for the whole
    // directory is stamped once, on the manifest itself.
    const pkg = entry.package ?? provenance.package;
    const installed = JSON.parse(await readFile(join(ROOT, 'node_modules', pkg, 'package.json'), 'utf8'));
    if (entry.package) entry.version = installed.version;
    else provenance.version = installed.version;

    if ('bytes' in entry) entry.bytes = (await readFile(target)).length;

    process.stdout.write(`${dir}/${name} ${installed.version} ${hash}\n`);
  }

  await writeFile(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);
  return replacements;
}

const replacements = await refresh('vendor');
await refresh('fonts');

// Only the import map pins a hash in the document; the fonts are reached from
// the stylesheet by name, so nothing there needs rewriting.
if (replacements.size > 0) {
  const htmlPath = join(ROOT, 'web/index.html');
  let html = await readFile(htmlPath, 'utf8');
  for (const [from, to] of replacements) html = html.replaceAll(from, to);
  await writeFile(htmlPath, html);
  process.stdout.write('web/index.html hashes updated\n');
}
