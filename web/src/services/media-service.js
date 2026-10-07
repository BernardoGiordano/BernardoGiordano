import { token } from '@srljs/core';

/** @import { AuthSession } from '@srljs/core' */

/** @type {import('@core/foundation/types.js').InjectionToken<MediaService>} */
export const MEDIA = token('MediaService');

/**
 * Uploads go through the session rather than the JSON client: the body is
 * multipart, and `ApiClient` exists to send and read JSON.
 */
export class MediaService {
  #session;

  /** @param {AuthSession} session */
  constructor(session) {
    this.#session = session;
  }

  /**
   * @param {Blob} file
   * @param {{ purpose?: string, filename?: string }} [options]
   * @returns {Promise<{ id: number, url: string, width: number, height: number }>}
   */
  async upload(file, options) {
    const form = new FormData();
    form.append('file', file, options?.filename ?? 'upload');
    form.append('purpose', options?.purpose ?? 'post');

    const response = await this.#session.fetch('/api/media', { method: 'POST', body: form });
    if (!response.ok) throw new Error(`Upload failed with ${String(response.status)}`);
    return response.json();
  }
}
