// See blog-service.test.js for why the harness is imported by a relative path.
import { assert, mount, settled, unmountAll } from '../../node_modules/@srljs/core/lib/test/harness.js';
import { configureClock, createManualClock } from '@core/foundation/clock.js';

import { registerAppTemplateGlobals } from '../src/template-globals.js';
import { RowTools } from '../src/components/row-tools.js';

// `icon` is a template global this site's markup names, and row-tools.html names
// it. Registered through the application's own function rather than a stub, so a
// global added there is one this suite already has.
registerAppTemplateGlobals();

/** @import { ManualClock } from '@core/foundation/types.js' */

/**
 * The clock the arm timeout is scheduled on. Installed for every case, so nothing
 * here waits on real milliseconds: `await wait(5000)` would assert "nothing
 * happened within five seconds", which is both slower and a weaker claim than the
 * one these cases mean.
 *
 * @type {ManualClock}
 */
let clock;

/** @returns {Promise<RowTools>} */
async function rowTools() {
  const element = /** @type {RowTools} */ (mount('<row-tools can-delete></row-tools>'));
  await settled(element);
  return element;
}

describe('row-tools', () => {
  beforeEach(() => {
    clock = createManualClock();
    configureClock({ clock });
  });

  afterEach(() => {
    unmountAll();
    configureClock();
  });

  it('arms the delete, and the clock owns the disarm', async () => {
    const tools = await rowTools();

    tools.pressDelete();
    assert.ok(tools.confirming.value, 'the first press asks the question');
    assert.equal(clock.pending, 1, 'and schedules the answer expiring');

    clock.flush();
    await settled(tools);

    assert.notOk(tools.confirming.value, 'a row left mid-confirm disarms itself');
    assert.equal(clock.pending, 0);
  });

  it('takes the disarm back out of the clock when the row is cancelled', async () => {
    const tools = await rowTools();

    tools.pressDelete();
    tools.cancel();

    assert.notOk(tools.confirming.value);
    assert.equal(clock.pending, 0, 'nothing is left waiting to fire at a dead element');
  });

  it('cancels the disarm when the element goes', async () => {
    const tools = await rowTools();

    tools.pressDelete();
    assert.equal(clock.pending, 1);

    unmountAll();
    await settled(tools);

    assert.equal(clock.pending, 0);
  });

  it('ignores the second half of a double click', async () => {
    const tools = await rowTools();

    /** @type {string[]} */
    const seen = [];
    tools.addEventListener('remove', () => seen.push('remove'));

    // Two presses in the same turn are inside the 300ms the arm is deaf for, and
    // that window is elapsed wall-clock rather than scheduled work: the clock owns
    // when the arm expires, not how long ago it was armed.
    tools.pressDelete();
    tools.pressDelete();

    assert.sameArray(seen, [], 'the point of the step is that the question gets read');
    assert.ok(tools.confirming.value, 'so the question is still up');
    assert.equal(clock.pending, 1, 'and its disarm is still waiting');
  });
});
