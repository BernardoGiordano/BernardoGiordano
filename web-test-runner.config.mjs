/**
 * The site's own suite, in a real browser, against the files the browser loads.
 *
 * No transform, no jsdom, no module mocking. The toolchain's preset makes the
 * runner's origin look like the deployed one: `/lib/` and `/components/` resolve
 * into the installed package, every top-level entry of `web/` resolves at the root,
 * and the page carries `web/index.html`'s own import map. `@core/` in a test
 * therefore resolves to the bytes production resolves, and root-absolute URLs in
 * application code resolve with no test-only branch in the source.
 *
 * The preset also enforces Trusted Types with the library's four policies, maps
 * the published harness at `@srljs/core/testing/harness.js`, and answers only
 * loopback requests for test files it registered. A sink this site adds without a
 * policy fails here rather than in production.
 */

import { testRunnerConfig } from '@srljs/cli/testing/web-test-runner.mjs';

export default testRunnerConfig({ app: process.env.APP ?? 'web' });
