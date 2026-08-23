import { token } from '@core/foundation/inject.js';
import { signal } from '@core/foundation/reactive.js';

/** @import { ApiClient } from '@core/http/client.js' */
/** @import { CvItem, CvSection } from './types.js' */

/** @type {import('@core/foundation/types.js').InjectionToken<CvService>} */
export const CV = token('CvService');

export class CvService {
  #client;

  /** @type {import('@preact/signals-core').Signal<readonly CvSection[]>} */
  sections = signal([]);

  isLoading = signal(false);
  loaded = signal(false);

  /** @param {ApiClient} client */
  constructor(client) {
    this.#client = client;
  }

  async load() {
    this.isLoading.value = true;
    try {
      /** @type {{ sections: readonly CvSection[] }} */
      const body = await this.#client.get('/cv');
      this.sections.value = body.sections;
      this.loaded.value = true;
    } finally {
      this.isLoading.value = false;
    }
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
