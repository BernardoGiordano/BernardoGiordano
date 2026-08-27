import { token } from '@core/foundation/inject.js';
import { signal } from '@core/foundation/reactive.js';
import { resource } from '@core/foundation/resource.js';

/** @import { ApiClient } from '@core/http/client.js' */
/** @import { Profile, SiteLink, SiteTotals } from './types.js' */

/** @type {import('@core/foundation/types.js').InjectionToken<ContentService>} */
export const CONTENT = token('ContentService');

/**
 * One request's worth of shell. Nullable where the service's own signals are,
 * so the read's seed and the three signals it settles into are one shape.
 *
 * @typedef {{ profile: Profile | null, links: readonly SiteLink[], totals: SiteTotals | null }} Site
 */

/** What the read is seeded with. The rail binds the three signals, not this. */
/** @type {Site} */
const EMPTY = { profile: null, links: [], totals: null };

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

  /**
   * The read. It replaces a promise this service used to hold so that two callers
   * would share one request, and the replacement is not merely tidier: the rail
   * remounts after a sign-in, /site answers differently for a session that can
   * edit, and joining the request already in flight served the signed-out view to
   * a signed-in reader. The second call now supersedes the first instead.
   * art-service.js says why the three signals below are not this resource's value.
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
   * @returns {Promise<Site>}
   */
  #fetch(signal) {
    return this.#client.get('/site', undefined, signal);
  }

  async load() {
    const body = await this.#read.reload();
    if (body === undefined) return;
    this.profile.value = body.profile;
    this.links.value = body.links;
    this.totals.value = body.totals;
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
