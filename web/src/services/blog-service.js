import { token } from '@core/foundation/inject.js';
import { signal } from '@core/foundation/reactive.js';
import { resource } from '@core/foundation/resource.js';

/** @import { ApiClient } from '@core/http/client.js' */
/** @import { Post, PostSummary } from './types.js' */

/** @type {import('@core/foundation/types.js').InjectionToken<BlogService>} */
export const BLOG = token('BlogService');

const PAGE_SIZE = 12;

/** What the read is seeded with. Screens bind `rows`, so nothing renders it. */
/** @type {{ rows: readonly PostSummary[], total: number, tags: readonly string[] }} */
const EMPTY = { rows: [], total: 0, tags: [] };

export class BlogService {
  #client;

  /** @type {import('@preact/signals-core').Signal<readonly PostSummary[]>} */
  rows = signal([]);

  /** @type {import('@preact/signals-core').Signal<readonly string[]>} */
  tags = signal([]);

  total = signal(0);
  loaded = signal(false);

  /** @type {Map<string, Post>} */
  #posts = new Map();

  /**
   * What the read will send. `load()` sets it immediately before reloading, and
   * the loader is the only reader: the query and the request that carries it can
   * never disagree, because nothing runs between the two lines.
   *
   * @type {{ tag?: string, offset: number, limit: number }}
   */
  #query = { offset: 0, limit: PAGE_SIZE };

  /**
   * The read, and what makes a tag change safe. /blog and /blog?tag=x are the
   * same route, so switching chips twice quickly leaves two requests in the air;
   * without supersession the slower one lands last and the list under a chip is
   * the list for a different chip. art-service.js says why `rows` is not this
   * resource's value.
   */
  #read = resource((signal) => this.#fetch(signal), { initial: EMPTY });

  isLoading = this.#read.pending;
  failed = this.#read.failed;

  /** @param {ApiClient} client */
  constructor(client) {
    this.#client = client;
  }

  /**
   * @param {AbortSignal} signal
   * @returns {Promise<{ rows: readonly PostSummary[], total: number, tags: readonly string[] }>}
   */
  #fetch(signal) {
    return this.#client.get('/posts', this.#query, signal);
  }

  get pageSize() {
    return PAGE_SIZE;
  }

  /**
   * @param {{ tag?: string, offset?: number, append?: boolean }} [options]
   */
  async load(options) {
    const { tag, offset = 0, append = false } = options ?? {};
    this.#query = { tag, offset, limit: PAGE_SIZE };

    const body = await this.#read.reload();
    // Superseded, aborted or rejected: the request that replaced this one owns
    // the flags and the rows, so this call writes nothing at all — which is the
    // whole point, since `append` and `rows` below belong to this call's page.
    if (body === undefined) return;

    this.rows.value = append ? [...this.rows.value, ...body.rows] : body.rows;
    this.total.value = body.total;
    this.tags.value = body.tags;
    this.loaded.value = true;
  }

  /**
   * @param {string} slug
   * @param {AbortSignal} [signal] Aborts the request. A cached post ignores it,
   *   because there is no request to abort.
   */
  async post(slug, signal) {
    const cached = this.#posts.get(slug);
    if (cached !== undefined) return cached;
    /** @type {Post} */
    const post = await this.#client.get(`/posts/${encodeURIComponent(slug)}`, undefined, signal);
    this.#posts.set(slug, post);
    return post;
  }

  /** @param {Partial<Post>} post */
  async create(post) {
    /** @type {Post} */
    const created = await this.#client.post('/posts', post);
    this.#posts.set(created.slug, created);
    this.rows.value = [created, ...this.rows.value];
    return created;
  }

  /**
   * @param {number} id
   * @param {Partial<Post>} patch
   */
  async save(id, patch) {
    /** @type {Post} */
    const saved = await this.#client.put(`/posts/${String(id)}`, patch);
    // An edit may have moved the slug, and the entry under the old one would
    // otherwise serve a post that no longer lives at that address.
    for (const [slug, cached] of this.#posts) if (cached.id === id) this.#posts.delete(slug);
    this.#posts.set(saved.slug, saved);
    this.rows.value = this.rows.value.map((row) => (row.id === id ? saved : row));
    return saved;
  }

  /**
   * @param {number} id
   * @param {string} slug
   */
  async remove(id, slug) {
    await this.#client.delete(`/posts/${String(id)}`);
    this.#posts.delete(slug);
    this.rows.value = this.rows.value.filter((row) => row.id !== id);
  }
}
