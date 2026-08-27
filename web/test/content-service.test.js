// See blog-service.test.js for why the harness is imported by a relative path.
import { assert } from '../../node_modules/@srljs/core/lib/test/harness.js';
import { ContentService } from '../src/services/content-service.js';

/** @import { ApiClient } from '@core/http/client.js' */

/**
 * @returns {{ calls: Array<{ signal: AbortSignal | undefined, resolve: (body: unknown) => void, reject: (cause: unknown) => void }>, client: ApiClient }}
 */
function fakeClient() {
  /** @type {Array<{ signal: AbortSignal | undefined, resolve: (body: unknown) => void, reject: (cause: unknown) => void }>} */
  const calls = [];
  const client = {
    /**
     * @param {string} _path
     * @param {unknown} _query
     * @param {AbortSignal} [signal]
     */
    get(_path, _query, signal) {
      return new Promise((resolve, reject) => {
        calls.push({ signal, resolve, reject });
      });
    },
  };
  return { calls, client: /** @type {ApiClient} */ (/** @type {unknown} */ (client)) };
}

/** @param {string} name */
function site(name) {
  return {
    profile: { name },
    links: [{ id: 1, label: name }],
    totals: { stars: 1, downloads: 2 },
  };
}

function tick() {
  return Promise.resolve();
}

describe('ContentService', () => {
  it('takes the second read over the first', async () => {
    const { calls, client } = fakeClient();
    const service = new ContentService(client);

    // The rail remounts after a sign-in, and /site answers differently for a
    // session that can edit. This used to join the request already in flight,
    // which served the signed-out shell to a signed-in reader.
    const anonymous = service.load();
    await tick();
    const signedIn = service.load();
    await tick();

    assert.equal(calls.length, 2, 'the second mount asks again');
    assert.ok(calls[0]?.signal?.aborted, 'and supersedes the first');

    calls[1]?.resolve(site('signed in'));
    calls[0]?.resolve(site('anonymous'));
    await Promise.all([anonymous, signedIn]);

    assert.equal(service.profile.value?.name, 'signed in');
    assert.equal(service.links.value.length, 1);
    assert.notOk(service.isLoading.value);
  });

  it('leaves the shell it has when a read fails', async () => {
    const { calls, client } = fakeClient();
    const service = new ContentService(client);

    const first = service.load();
    await tick();
    calls[0]?.resolve(site('kept'));
    await first;

    const second = service.load();
    await tick();
    calls[1]?.reject(new Error('offline'));
    await second;

    assert.ok(service.failed.value);
    assert.equal(service.profile.value?.name, 'kept', 'a failure is not an empty rail');
  });
});
