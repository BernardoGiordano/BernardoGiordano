import {
  AuthRejected,
  AuthUnavailable,
  asRecord,
  failureFor,
  readPayload,
  requireInstant,
  requireString,
  requireStrings,
  sessionFrom,
  unreachable,
} from '@srljs/core';

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
    if (!response.ok) throw this.#fail(await failureFor(response, where));
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
      throw this.#fail(new AuthRejected(`${where} rejected the credentials.`));
    }
    if (!response.ok) throw this.#fail(await failureFor(response, where));
    return this.#read(response, where);
  }

  /**
   * Rejects unless the backend confirms, because a cookie it never cleared
   * restores the session on the next load, and the owner should hear that.
   */
  async logout() {
    this.#csrfToken = null;
    const where = `The logout endpoint ${this.#baseUrl}/login`;
    const response = await this.#send(
      `${this.#baseUrl}/login`,
      { method: 'DELETE', credentials: 'same-origin' },
      where,
    );
    if (!response.ok) throw await failureFor(response, where);
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
   * The failure to raise, with the CSRF token dropped unless the failure is
   * transient. `AuthSession` ends the session on a refused or unadmissible
   * answer, and a token kept past that would go on marking writes for a session
   * that has ended. An unreachable or 5xx backend decides nothing, so the
   * session and its token stay.
   *
   * @param {AuthRejected | AuthUnavailable} failure
   * @returns {AuthRejected | AuthUnavailable}
   */
  #fail(failure) {
    if (!(failure instanceof AuthUnavailable)) this.#csrfToken = null;
    return failure;
  }

  /**
   * The session a payload describes. The CSRF token changes only after the
   * whole payload is admitted, and a payload that fails admission drops it.
   *
   * @param {Response} response
   * @param {string} where
   * @returns {Promise<Session>}
   */
  async #read(response, where) {
    try {
      const payload = asRecord(await readPayload(response, where), where);

      // A `/session` probe need not reissue the CSRF token. Keeping the one we
      // hold when the field is absent is what makes a probe a probe rather than
      // something that can silently disarm every later write.
      const csrfToken =
        payload.csrfToken === undefined
          ? this.#csrfToken
          : requireString(payload.csrfToken, `${where}: csrfToken`);

      // The expiry arrives as an absolute instant rather than a lifetime,
      // because the backend owns the token and the browser holds none to time.
      const session = sessionFrom(
        {
          subject: payload.sub,
          name: payload.name,
          scopes: payload.scopes === undefined ? [] : requireStrings(payload.scopes, `${where}: scopes`),
          expiresAt: requireInstant(payload.expiresAt, `${where}: expiresAt`),
        },
        where,
      );

      this.#csrfToken = csrfToken;
      return session;
    } catch (cause) {
      if (!(cause instanceof AuthUnavailable)) this.#csrfToken = null;
      throw cause;
    }
  }
}
