// See blog-service.test.js for why the harness is imported by a relative path.
import { assert, mount, settled, unmountAll } from '../../node_modules/@srljs/core/lib/test/harness.js';

import { registerAppTemplateGlobals } from '../src/template-globals.js';
import { AppRoot } from '../src/app-root.js';

registerAppTemplateGlobals();

/**
 * The shell renders, and it renders the outlet the router looks for.
 *
 * One case, and it is here because a shell that throws during its first update
 * takes the whole site with it and nothing else in this repository would notice.
 * `srl check templates` reads bindings against the class and passes on a name the
 * class has; the build emits an artifact either way. Only a render finds a member
 * that collides with one of Lit's — `updated` is called with the changed
 * properties after every render, so a field of that name is a TypeError on the
 * first paint and on no earlier step.
 */
describe('app-root', () => {
  afterEach(() => {
    unmountAll();
  });

  it('completes a render cycle and offers the router its outlet', async () => {
    const element = /** @type {AppRoot} */ (mount('<app-root></app-root>'));
    await settled(element);

    assert.ok(element.querySelector('main'), 'the outlet attachRouter queries for');
    assert.equal(element.querySelectorAll('.build-notice').length, 0, 'no banner before a release moves');
  });
});
