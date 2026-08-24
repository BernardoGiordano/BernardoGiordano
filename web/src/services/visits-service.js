import { token } from '@core/foundation/inject.js';
import { signal } from '@core/foundation/reactive.js';

/** @import { ApiClient } from '@core/http/client.js' */

/** @type {import('@core/foundation/types.js').InjectionToken<VisitsService>} */
export const VISITS = token('VisitsService');

/**
 * How many times a thing has been looked at, and the one call that says so.
 *
 * Counting is fire and forget on purpose: nothing on a page waits for it, and a
 * request that fails is a view that was not counted rather than an error a
 * reader has to see. The backend decides what counts — it ignores crawlers, the
 * signed-in owner, and a reader it has already counted for the same thing inside
 * the window — so this side sends one call per thing per page session and reads
 * the total back.
 */
export class VisitsService {
  #client;

  /** The things this page session has already sent, as `scope:ref`. */
  #sent = new Set();

  /** @type {import('@preact/signals-core').Signal<ReadonlyMap<string, number>>} */
  views = signal(new Map());

  /** @param {ApiClient} client */
  constructor(client) {
    this.#client = client;
  }

  /**
   * @param {'tab' | 'post'} scope
   * @param {string} ref
   */
  record(scope, ref) {
    const key = `${scope}:${ref}`;
    if (ref === '' || this.#sent.has(key)) return;
    this.#sent.add(key);

    void this.#client
      .post('/visits', { scope, ref })
      .then((body) => {
        const total = /** @type {{ views?: number }} */ (body).views;
        if (typeof total !== 'number') return;
        const next = new Map(this.views.value);
        next.set(key, total);
        this.views.value = next;
      })
      .catch(() => {
        // A counter is not worth a console error on somebody's blog post.
      });
  }

  /**
   * The total this session has been told, or 0 before it has been told one. The
   * blog list does not read this — its rows carry their own count from the list
   * request — and a page showing one thing's number does.
   *
   * @param {'tab' | 'post'} scope
   * @param {string} ref
   */
  viewsOf(scope, ref) {
    return this.views.value.get(`${scope}:${ref}`) ?? 0;
  }
}
