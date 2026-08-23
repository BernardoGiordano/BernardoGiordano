import { token } from '@core/foundation/inject.js';
import { signal } from '@core/foundation/reactive.js';

/** @import { ApiClient } from '@core/http/client.js' */
/** @import { Project } from './types.js' */

/** @type {import('@core/foundation/types.js').InjectionToken<ProjectsService>} */
export const PROJECTS = token('ProjectsService');

export class ProjectsService {
  #client;

  /** @type {import('@preact/signals-core').Signal<readonly Project[]>} */
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
      /** @type {{ rows: readonly Project[] }} */
      const body = await this.#client.get('/projects');
      this.rows.value = body.rows;
      this.loaded.value = true;
    } finally {
      this.isLoading.value = false;
    }
  }

  /** @param {Partial<Project>} project */
  async create(project) {
    /** @type {Project} */
    const created = await this.#client.post('/projects', project);
    this.rows.value = [...this.rows.value, created];
    return created;
  }

  /**
   * @param {number} id
   * @param {Partial<Project>} patch
   */
  async save(id, patch) {
    /** @type {Project} */
    const saved = await this.#client.put(`/projects/${String(id)}`, patch);
    this.rows.value = this.rows.value.map((row) => (row.id === id ? saved : row));
    return saved;
  }

  /** @param {number} id */
  async remove(id) {
    await this.#client.delete(`/projects/${String(id)}`);
    this.rows.value = this.rows.value.filter((row) => row.id !== id);
  }

  /** @param {readonly number[]} ids */
  async reorder(ids) {
    /** @type {{ rows: readonly Project[] }} */
    const body = await this.#client.post('/projects/reorder', { ids });
    this.rows.value = body.rows;
  }

  /** Ask the backend to re-poll GitHub for one project now. @param {number} id */
  async refreshStats(id) {
    /** @type {Project} */
    const saved = await this.#client.post(`/projects/${String(id)}/refresh`, {});
    this.rows.value = this.rows.value.map((row) => (row.id === id ? saved : row));
    return saved;
  }
}
