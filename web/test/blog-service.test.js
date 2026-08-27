// Relative rather than through the `/lib/` mount the application uses, because
// this specifier has to mean the same file to two resolvers: the browser serving
// the repository root, and tsc type-checking this suite from disk.
import { assert } from '../../node_modules/@srljs/core/lib/test/harness.js';
import { BlogService } from '../src/services/blog-service.js';

/** @import { ApiClient } from '@core/http/client.js' */
/** @import { PostSummary } from '../src/services/types.js' */

/**
 * An `ApiClient` that answers when a case says so, and remembers what it was
 * asked with. A fake rather than a stubbed `fetch`: what is under test is which
 * response the service keeps, and that is decided entirely by the order the two
 * promises settle in — which a real transport does not let a test choose.
 *
 * @returns {{ calls: Array<{ query: unknown, signal: AbortSignal | undefined, resolve: (body: unknown) => void, reject: (cause: unknown) => void }>, client: ApiClient }}
 */
function fakeClient() {
  /** @type {Array<{ query: unknown, signal: AbortSignal | undefined, resolve: (body: unknown) => void, reject: (cause: unknown) => void }>} */
  const calls = [];
  const client = {
    /**
     * @param {string} _path
     * @param {unknown} query
     * @param {AbortSignal} [signal]
     */
    get(_path, query, signal) {
      return new Promise((resolve, reject) => {
        calls.push({ query, signal, resolve, reject });
      });
    },
  };
  return { calls, client: /** @type {ApiClient} */ (/** @type {unknown} */ (client)) };
}

/** @param {number} id @returns {PostSummary} */
function post(id) {
  return /** @type {PostSummary} */ (/** @type {unknown} */ ({ id, slug: `post-${String(id)}` }));
}

/** @param {readonly PostSummary[]} rows @param {readonly string[]} tags */
function page(rows, tags = []) {
  return { rows, total: rows.length, tags };
}

/** One microtask, which is all a synchronous request start needs to have happened. */
function tick() {
  return Promise.resolve();
}

describe('BlogService', () => {
  it('is pending before anything has been asked for', () => {
    const { client } = fakeClient();
    const service = new BlogService(client);
    assert.ok(service.isLoading.value, 'pending until the first read settles');
    assert.notOk(service.failed.value);
    assert.notOk(service.loaded.value);
  });

  it('keeps the response for the query that was asked for last', async () => {
    const { calls, client } = fakeClient();
    const service = new BlogService(client);

    const first = service.load({ tag: 'a' });
    await tick();
    const second = service.load({ tag: 'b' });
    await tick();

    assert.equal(calls.length, 2);

    // The slower one answers last, which is the whole failure: a chip switched
    // twice used to leave the list under 'b' holding the posts tagged 'a'.
    calls[1]?.resolve(page([post(2)], ['b']));
    calls[0]?.resolve(page([post(1)], ['a']));
    await Promise.all([first, second]);

    assert.sameArray(
      service.rows.value.map((row) => row.id),
      [2],
      "the list is the one the last query asked for",
    );
    assert.sameArray(service.tags.value, ['b']);
    assert.notOk(service.isLoading.value);
  });

  it('aborts the request it supersedes', async () => {
    const { calls, client } = fakeClient();
    const service = new BlogService(client);

    void service.load({ tag: 'a' });
    await tick();
    void service.load({ tag: 'b' });
    await tick();

    assert.ok(calls[0]?.signal?.aborted, 'the superseded request is aborted');
    assert.notOk(calls[1]?.signal?.aborted, 'the current one is not');
  });

  it('sends the query the caller asked for', async () => {
    const { calls, client } = fakeClient();
    const service = new BlogService(client);

    void service.load({ tag: 'x', offset: 24 });
    await tick();

    assert.equal(JSON.stringify(calls[0]?.query), JSON.stringify({ tag: 'x', offset: 24, limit: 12 }));
  });

  it('appends a page to the list it already has', async () => {
    const { calls, client } = fakeClient();
    const service = new BlogService(client);

    const first = service.load({});
    await tick();
    calls[0]?.resolve(page([post(1), post(2)]));
    await first;

    const more = service.load({ offset: 2, append: true });
    await tick();
    calls[1]?.resolve(page([post(3)]));
    await more;

    assert.sameArray(
      service.rows.value.map((row) => row.id),
      [1, 2, 3],
    );
  });

  it('writes nothing for an append that was superseded', async () => {
    const { calls, client } = fakeClient();
    const service = new BlogService(client);

    const first = service.load({});
    await tick();
    calls[0]?.resolve(page([post(1)]));
    await first;

    // Load more, then switch tag before the page arrives. The append belongs to
    // the query that has been replaced, so it must not extend the new list.
    const appended = service.load({ offset: 1, append: true });
    await tick();
    const switched = service.load({ tag: 'b' });
    await tick();

    calls[2]?.resolve(page([post(9)], ['b']));
    calls[1]?.resolve(page([post(2)]));
    await Promise.all([appended, switched]);

    assert.sameArray(
      service.rows.value.map((row) => row.id),
      [9],
    );
  });

  it('raises failed for a read that rejects, and clears it on the retry', async () => {
    const { calls, client } = fakeClient();
    const service = new BlogService(client);

    const first = service.load({});
    await tick();
    calls[0]?.reject(new Error('offline'));
    await first;

    assert.ok(service.failed.value, 'the failure is a state the page can render');
    assert.notOk(service.isLoading.value);
    assert.notOk(service.loaded.value);

    const retry = service.load({});
    await tick();
    assert.notOk(service.failed.value, 'cleared the moment the retry starts');
    assert.ok(service.isLoading.value);

    calls[1]?.resolve(page([post(1)]));
    await retry;

    assert.ok(service.loaded.value);
    assert.notOk(service.failed.value);
  });

  it('does not raise failed for a read that was only superseded', async () => {
    const { calls, client } = fakeClient();
    const service = new BlogService(client);

    const first = service.load({ tag: 'a' });
    await tick();
    const second = service.load({ tag: 'b' });
    await tick();

    calls[0]?.reject(new DOMException('aborted', 'AbortError'));
    calls[1]?.resolve(page([post(2)], ['b']));
    await Promise.all([first, second]);

    assert.notOk(service.failed.value, 'a superseded rejection is not the page failing');
    assert.sameArray(
      service.rows.value.map((row) => row.id),
      [2],
    );
  });
});
