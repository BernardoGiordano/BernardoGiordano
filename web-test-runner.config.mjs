/**
 * The site's own suite, in a real browser, against the files the browser loads.
 *
 * No transform, no jsdom, no module mocking. The one thing this file does is make
 * the runner's origin look like the deployed one, because that is the difference
 * between a test and a test of something else: the page carries `web/index.html`'s
 * own import map, so `@core/` in a test resolves to the same bytes production
 * resolves, and root-absolute URLs in application code — `/app.manifest.json`,
 * the i18n bundle pattern, a template beside its component — resolve with no
 * test-only branch in the source.
 *
 * WHY THERE IS NO MOUNT TABLE WRITTEN OUT HERE
 *
 * `/lib/` and `/components/` are the library's own mounts, and where they sit is
 * a fact about the install rather than about this repository: `LIB_MOUNT_ROUTES`
 * reads them from the installed package, so bumping @srljs/core cannot leave a
 * stale path in this file. The rewrite itself is `resolveMount` from the
 * toolchain's origin module — the same rule `srl serve` and the production
 * artifact's own test origin resolve a URL with, rather than a fourth spelling of
 * "first matching prefix wins".
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { LIB_MOUNT_ROUTES, REPO } from '@srljs/cli/layout.mjs';
import { resolveMount } from '@srljs/cli/origin/index.mjs';
import { extractImportMap } from '@srljs/cli/package/interface.mjs';

const APP = process.env.APP ?? 'web';

/**
 * URL prefix -> URL on the runner's origin, which serves the repository root.
 *
 * Order matters, and the library's mounts come first: `/lib/vendor/lit-all.min.js`
 * belongs to the library and `/vendor/marked.esm.js` to the site, and only the
 * order below tells those two apart. Anything absent is left alone, which is what
 * keeps the runner's own URLs, the test files and /node_modules working.
 */
const MOUNTS = /** @type {Array<[string, string]>} */ ([
  ...LIB_MOUNT_ROUTES,
  ['/src/', `/${APP}/src/`],
  ['/i18n/', `/${APP}/i18n/`],
  ['/vendor/', `/${APP}/vendor/`],
  ['/app.manifest.json', `/${APP}/app.manifest.json`],
  ['/site.css', `/${APP}/site.css`],
  ['/app.css', `/${APP}/app.css`],
  ['/favicon.svg', `/${APP}/favicon.svg`],
]);

/**
 * The import-map element the test page carries: the application's own, read from
 * the document production serves rather than copied into this file.
 *
 * The integrity pins for files the runner serves off disk are dropped. Those
 * bytes are the vendored copies `npm run vendor` already hashes, the runner is
 * free to add its own instrumentation to anything it serves, and a suite that
 * failed on a hash would be reporting on the runner rather than on the site.
 *
 * @param {string} app
 * @returns {string}
 */
function importMapFor(app) {
  const html = readFileSync(join(REPO, app, 'index.html'), 'utf8');
  const { imports, integrity } = extractImportMap(html, `${app}/index.html`);
  const served = ['/lib/vendor/', '/vendor/'];
  const pins = Object.fromEntries(
    Object.entries(integrity).filter(([url]) => !served.some((prefix) => url.startsWith(prefix))),
  );
  const body = JSON.stringify({ imports, integrity: pins }, null, 2);
  return `<script type="importmap">\n${body}\n    </script>`;
}

/** @type {import('@web/test-runner').TestRunnerConfig} */
export default {
  files: [`${APP}/test/**/*.test.js`],
  nodeResolve: false,
  concurrency: 1,

  middleware: [
    async (ctx, next) => {
      // The path only: a query string is the runner's business, and percent
      // escapes are left alone because this rewrites a URL, not a file path.
      const mark = ctx.url.indexOf('?');
      const path = mark === -1 ? ctx.url : ctx.url.slice(0, mark);
      const search = mark === -1 ? '' : ctx.url.slice(mark);
      const match = resolveMount(path, MOUNTS);
      if (match !== null) ctx.url = `${match.target}${match.rest}${search}`;
      await next();
    },
  ],

  testFramework: {
    config: { ui: 'bdd', timeout: 4000 },
  },

  // Trusted Types enforced, as the built document enforces them. Four policies, and
  // only one of them is this repository's business: `lit-html` belongs to the
  // renderer, `ui-test` to the library's sanitizer and `ui-test-template` to its
  // runtime template compiler, and `test-harness` is the one the harness creates for
  // fixture markup. A sink this site adds without a policy fails here.
  testRunnerHtml: (testFramework) => `<!doctype html>
<html>
  <head>
    <meta
      http-equiv="Content-Security-Policy"
      content="trusted-types lit-html ui-test ui-test-template test-harness; require-trusted-types-for 'script'"
    >
    ${importMapFor(APP)}
  </head>
  <body>
    <script type="module" src="${testFramework}"></script>
  </body>
</html>`,
};
