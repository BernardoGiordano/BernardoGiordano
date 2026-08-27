import { token } from '@core/foundation/inject.js';
import { signal } from '@core/foundation/reactive.js';
import { resource } from '@core/foundation/resource.js';

/** @import { ApiClient } from '@core/http/client.js' */
/** @import { ArtWork } from './types.js' */

/** @type {import('@core/foundation/types.js').InjectionToken<ArtService>} */
export const ART = token('ArtService');

/** What the read is seeded with. Screens bind `rows`, so nothing renders it. */
/** @type {{ rows: readonly ArtWork[] }} */
const EMPTY = { rows: [] };

export class ArtService {
  #client;

  /** @type {import('@preact/signals-core').Signal<readonly ArtWork[]>} */
  rows = signal([]);

  loaded = signal(false);

  /**
   * The read, and the only thing that decides which response wins: it aborts the
   * request in flight, drops a response that arrives for an aborted one, and owns
   * the two flags below. `rows` stays a signal of this service's own because
   * create, save and remove write to it with no request of their own behind them
   * — `resource` is the primitive under a store rather than one itself.
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
   * @returns {Promise<{ rows: readonly ArtWork[] }>}
   */
  #fetch(signal) {
    return this.#client.get('/art', undefined, signal);
  }

  async load() {
    const body = await this.#read.reload();
    // Superseded, aborted or rejected: the request that replaced this one owns
    // the flags and the rows, so this call writes nothing at all.
    if (body === undefined) return;
    this.rows.value = body.rows;
    this.loaded.value = true;
  }

  /** @param {Partial<ArtWork>} work */
  async create(work) {
    /** @type {ArtWork} */
    const created = await this.#client.post('/art', work);
    this.rows.value = sortByRelease([...this.rows.value, created]);
    return created;
  }

  /**
   * @param {number} id
   * @param {Partial<ArtWork>} patch
   */
  async save(id, patch) {
    /** @type {ArtWork} */
    const saved = await this.#client.put(`/art/${String(id)}`, patch);
    this.rows.value = sortByRelease(this.rows.value.map((row) => (row.id === id ? saved : row)));
    return saved;
  }

  /** @param {number} id */
  async remove(id) {
    await this.#client.delete(`/art/${String(id)}`);
    this.rows.value = this.rows.value.filter((row) => row.id !== id);
  }
}

/**
 * Release date descending, which is the only order this tab has. The server sorts
 * too; this keeps an edit from jumping the row out of order until the next load.
 *
 * @param {readonly ArtWork[]} rows
 * @returns {readonly ArtWork[]}
 */
function sortByRelease(rows) {
  return [...rows].sort((left, right) => right.releasedOn.localeCompare(left.releasedOn));
}
