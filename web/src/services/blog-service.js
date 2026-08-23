import { token } from '@core/foundation/inject.js';
import { signal } from '@core/foundation/reactive.js';

/** @import { ApiClient } from '@core/http/client.js' */
/** @import { Post, PostSummary } from './types.js' */

/** @type {import('@core/foundation/types.js').InjectionToken<BlogService>} */
export const BLOG = token('BlogService');

const PAGE_SIZE = 12;

export class BlogService {
  #client;

  /** @type {import('@preact/signals-core').Signal<readonly PostSummary[]>} */
  rows = signal([]);

  /** @type {import('@preact/signals-core').Signal<readonly string[]>} */
  tags = signal([]);

  total = signal(0);
  isLoading = signal(false);
  loaded = signal(false);

  /** @type {Map<string, Post>} */
  #posts = new Map();

  /** @param {ApiClient} client */
  constructor(client) {
    this.#client = client;
  }

  get pageSize() {
    return PAGE_SIZE;
  }

  /**
   * @param {{ tag?: string, offset?: number, append?: boolean }} [options]
   */
  async load(options) {
    const { tag, offset = 0, append = false } = options ?? {};
    this.isLoading.value = true;
    try {
      /** @type {{ rows: readonly PostSummary[], total: number, tags: readonly string[] }} */
      const body = await this.#client.get('/posts', { tag, offset, limit: PAGE_SIZE });
      this.rows.value = append ? [...this.rows.value, ...body.rows] : body.rows;
      this.total.value = body.total;
      this.tags.value = body.tags;
      this.loaded.value = true;
    } finally {
      this.isLoading.value = false;
    }
  }

  /** @param {string} slug */
  async post(slug) {
    const cached = this.#posts.get(slug);
    if (cached !== undefined) return cached;
    /** @type {Post} */
    const post = await this.#client.get(`/posts/${encodeURIComponent(slug)}`);
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
