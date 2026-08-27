import { token } from '@core/foundation/inject.js';
import { signal } from '@core/foundation/reactive.js';
import { resource } from '@core/foundation/resource.js';

/** @import { ApiClient } from '@core/http/client.js' */
/** @import { CvItem, CvSection } from './types.js' */

/** @type {import('@core/foundation/types.js').InjectionToken<CvService>} */
export const CV = token('CvService');

/** What the read is seeded with. Screens bind `sections`, so nothing renders it. */
/** @type {{ sections: readonly CvSection[] }} */
const EMPTY = { sections: [] };

export class CvService {
  #client;

  /** @type {import('@preact/signals-core').Signal<readonly CvSection[]>} */
  sections = signal([]);

  loaded = signal(false);

  /** The read. art-service.js says what this owns and why `sections` is not it. */
  #read = resource((signal) => this.#fetch(signal), { initial: EMPTY });

  isLoading = this.#read.pending;
  failed = this.#read.failed;

  /** @param {ApiClient} client */
  constructor(client) {
    this.#client = client;
  }

  /**
   * @param {AbortSignal} signal
   * @returns {Promise<{ sections: readonly CvSection[] }>}
   */
  #fetch(signal) {
    return this.#client.get('/cv', undefined, signal);
  }

  async load() {
    const body = await this.#read.reload();
    if (body === undefined) return;
    this.sections.value = body.sections;
    this.loaded.value = true;
  }

  /** @param {{ title: string, kind?: string }} section */
  async addSection(section) {
    /** @type {{ sections: readonly CvSection[] }} */
    const body = await this.#client.post('/cv/sections', section);
    this.sections.value = body.sections;
  }

  /** @param {number} id */
  async removeSection(id) {
    /** @type {{ sections: readonly CvSection[] }} */
    const body = await this.#client.delete(`/cv/sections/${String(id)}`);
    this.sections.value = body.sections;
  }

  /** @param {readonly number[]} ids */
  async reorderSections(ids) {
    /** @type {{ sections: readonly CvSection[] }} */
    const body = await this.#client.post('/cv/sections/reorder', { ids });
    this.sections.value = body.sections;
  }

  /**
   * @param {number} sectionId
   * @param {readonly number[]} ids
   */
  async reorderItems(sectionId, ids) {
    /** @type {CvSection} */
    const saved = await this.#client.post(`/cv/sections/${String(sectionId)}/items/reorder`, { ids });
    this.sections.value = this.sections.value.map((row) => (row.id === sectionId ? saved : row));
  }

  /**
   * @param {number} id
   * @param {Partial<CvSection>} patch
   */
  async saveSection(id, patch) {
    /** @type {CvSection} */
    const saved = await this.#client.put(`/cv/sections/${String(id)}`, patch);
    this.sections.value = this.sections.value.map((row) => (row.id === id ? saved : row));
    return saved;
  }

  /**
   * @param {number} sectionId
   * @param {Partial<CvItem>} item
   */
  async addItem(sectionId, item) {
    /** @type {CvSection} */
    const saved = await this.#client.post(`/cv/sections/${String(sectionId)}/items`, item);
    this.sections.value = this.sections.value.map((row) => (row.id === sectionId ? saved : row));
    return saved;
  }

  /**
   * @param {number} sectionId
   * @param {number} itemId
   * @param {Partial<CvItem>} patch
   */
  async saveItem(sectionId, itemId, patch) {
    /** @type {CvSection} */
    const saved = await this.#client.put(`/cv/items/${String(itemId)}`, patch);
    this.sections.value = this.sections.value.map((row) => (row.id === sectionId ? saved : row));
    return saved;
  }

  /**
   * @param {number} sectionId
   * @param {number} itemId
   */
  async removeItem(sectionId, itemId) {
    /** @type {CvSection} */
    const saved = await this.#client.delete(`/cv/items/${String(itemId)}`);
    this.sections.value = this.sections.value.map((row) => (row.id === sectionId ? saved : row));
    return saved;
  }
}
