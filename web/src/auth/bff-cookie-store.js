import {
  AuthRejected,
  asRecord,
  failureFor,
  readPayload,
  requireInstant,
  requireString,
  requireStrings,
  sessionFrom,
  unreachable,
} from '@auth/session-policy.js';

/** @import { Session, TokenStore } from '@auth/types.js' */

/**
 * Backend-for-frontend, the strategy srl recommends and the only one that takes
 * tokens out of the browser's threat model. Adapted from srl's example store;
 * every wire fact below is a contract with api/, not with the library.
 *
 *   POST   /auth/login    credentials in, Set-Cookie + csrfToken out
 *   DELETE /auth/login    clears the cookie
 *   GET    /auth/session  the current session, or 401
 *
 * @implements {TokenStore}
 */
export class BffCookieTokenStore {
  strategy = /** @type {'bff'} */ ('bff');

  /** The CSRF token: not a secret from this page, proof a request came from it.
   * @type {string | null} */
  #csrfToken = null;

  #baseUrl;

  /** @param {string} baseUrl */
  constructor(baseUrl) {
    this.#baseUrl = baseUrl.replace(/\/+$/u, '');
  }

  /** @returns {Promise<Session | null>} */
  async init() {
    const where = `The session endpoint ${this.#baseUrl}/session`;
    const response = await this.#send(`${this.#baseUrl}/session`, { credentials: 'same-origin' }, where);

    // No cookie, or one the backend has already discarded. The ordinary
    // first-visit answer, not a failure.
    if (response.status === 401) {
      this.#csrfToken = null;
      return null;
    }
    if (!response.ok) throw await failureFor(response, where);
    return this.#read(response, where);
  }

  /**
   * @param {unknown} credentials
   * @returns {Promise<Session>}
   */
  async login(credentials) {
    const where = `The login endpoint ${this.#baseUrl}/login`;
    const body = asRecord(credentials, `${where}: credentials`);
    const response = await this.#send(
      `${this.#baseUrl}/login`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: requireString(body.username, `${where}: credentials.username`),
          password: requireString(body.password, `${where}: credentials.password`),
        }),
      },
      where,
    );

    if (response.status === 401 || response.status === 403) {
      throw new AuthRejected(`${where} rejected the credentials.`);
    }
    if (!response.ok) throw await failureFor(response, where);
    return this.#read(response, where);
  }

  async logout() {
    this.#csrfToken = null;
    await fetch(`${this.#baseUrl}/login`, {
      method: 'DELETE',
      credentials: 'same-origin',
    }).catch(() => undefined);
  }

  /** @returns {Promise<Session | null>} */
  refresh() {
    return this.init();
  }

  /**
   * @param {Request} request
   * @returns {Promise<Request>}
   */
  authorize(request) {
    const authorized = new Request(request);
    if (this.#csrfToken !== null) {
      authorized.headers.set('X-CSRF-Token', this.#csrfToken);
    }
    return Promise.resolve(authorized);
  }

  /**
   * @param {string} url
   * @param {RequestInit} init
   * @param {string} where
   * @returns {Promise<Response>}
   */
  async #send(url, init, where) {
    try {
      return await fetch(url, init);
    } catch (cause) {
      throw unreachable(where, cause);
    }
  }

  /**
   * @param {Response} response
   * @param {string} where
   * @returns {Promise<Session>}
   */
  async #read(response, where) {
    const payload = asRecord(await readPayload(response, where), where);

    // A `/session` probe need not reissue the CSRF token. Keeping the one we hold
    // when the field is absent is what makes a probe a probe rather than
    // something that can silently disarm every later write.
    if (payload.csrfToken !== undefined) {
      this.#csrfToken = requireString(payload.csrfToken, `${where}: csrfToken`);
    }

    // The expiry arrives as an absolute instant rather than a lifetime, because
    // the backend owns the token and the browser holds none to time.
    return sessionFrom(
      {
        subject: payload.sub,
        name: payload.name,
        scopes: payload.scopes === undefined ? [] : requireStrings(payload.scopes, `${where}: scopes`),
        expiresAt: requireInstant(payload.expiresAt, `${where}: expiresAt`),
      },
      where,
    );
  }
}
