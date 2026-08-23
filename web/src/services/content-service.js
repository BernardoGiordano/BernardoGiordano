import { token } from '@core/foundation/inject.js';
import { signal } from '@core/foundation/reactive.js';

/** @import { ApiClient } from '@core/http/client.js' */
/** @import { Profile, SiteLink, SiteTotals } from './types.js' */

/** @type {import('@core/foundation/types.js').InjectionToken<ContentService>} */
export const CONTENT = token('ContentService');

/**
 * The shell's data. One request, because the shell is one thing: a profile, the
 * links under it and the two totals in the tab bar are on every page and none of
 * them is ever rendered without the others.
 */
export class ContentService {
  #client;

  /** @type {import('@preact/signals-core').Signal<Profile | null>} */
  profile = signal(null);

  /** @type {import('@preact/signals-core').Signal<readonly SiteLink[]>} */
  links = signal([]);

  /** @type {import('@preact/signals-core').Signal<SiteTotals | null>} */
  totals = signal(null);

  isLoading = signal(false);

  /** @type {Promise<void> | null} */
  #pending = null;

  /** @param {ApiClient} client */
  constructor(client) {
    this.#client = client;
  }

  /** Idempotent: the rail is mounted once and every page may ask for it. */
  load() {
    this.#pending ??= this.#load().finally(() => {
      this.#pending = null;
    });
    return this.#pending;
  }

  async #load() {
    this.isLoading.value = true;
    try {
      /** @type {{ profile: Profile, links: readonly SiteLink[], totals: SiteTotals }} */
      const body = await this.#client.get('/site');
      this.profile.value = body.profile;
      this.links.value = body.links;
      this.totals.value = body.totals;
    } finally {
      this.isLoading.value = false;
    }
  }

  /** @param {Partial<Profile>} patch */
  async saveProfile(patch) {
    /** @type {Profile} */
    const saved = await this.#client.put('/profile', patch);
    this.profile.value = saved;
    return saved;
  }

  /** @param {Omit<SiteLink, 'id' | 'position'>} link */
  async addLink(link) {
    /** @type {SiteLink} */
    const created = await this.#client.post('/links', link);
    this.links.value = [...this.links.value, created];
    return created;
  }

  /**
   * @param {number} id
   * @param {Partial<SiteLink>} patch
   */
  async saveLink(id, patch) {
    /** @type {SiteLink} */
    const saved = await this.#client.put(`/links/${String(id)}`, patch);
    this.links.value = this.links.value.map((link) => (link.id === id ? saved : link));
    return saved;
  }

  /** @param {number} id */
  async removeLink(id) {
    await this.#client.delete(`/links/${String(id)}`);
    this.links.value = this.links.value.filter((link) => link.id !== id);
  }

  /** @param {readonly number[]} ids */
  async reorderLinks(ids) {
    /** @type {readonly SiteLink[]} */
    const rows = await this.#client.post('/links/reorder', { ids });
    this.links.value = rows;
  }
}
