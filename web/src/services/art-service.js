import { token } from '@core/foundation/inject.js';
import { signal } from '@core/foundation/reactive.js';

/** @import { ApiClient } from '@core/http/client.js' */
/** @import { ArtWork } from './types.js' */

/** @type {import('@core/foundation/types.js').InjectionToken<ArtService>} */
export const ART = token('ArtService');

export class ArtService {
  #client;

  /** @type {import('@preact/signals-core').Signal<readonly ArtWork[]>} */
  rows = signal([]);

  isLoading = signal(false);
  loaded = signal(false);

  /** @param {ApiClient} client */
  constructor(client) {
    this.#client = client;
  }

  async load() {
    this.isLoading.value = true;
    try {
      /** @type {{ rows: readonly ArtWork[] }} */
      const body = await this.#client.get('/art');
      this.rows.value = body.rows;
      this.loaded.value = true;
    } finally {
      this.isLoading.value = false;
    }
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
