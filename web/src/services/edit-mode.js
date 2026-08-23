import { token } from '@core/foundation/inject.js';
import { computed, signal } from '@core/foundation/reactive.js';

/** @import { AuthSession } from '@auth/session.js' */

/** @type {import('@core/foundation/types.js').InjectionToken<EditMode>} */
export const EDIT_MODE = token('EditMode');

/**
 * Whether edit affordances are on screen. Two separate facts on purpose: `canEdit`
 * is the session's answer and nothing here can change it, `isOn` is a toggle the
 * signed-in owner flips. Neither is access control — every write is authorized
 * again by api/, because a hidden button is not a permission check.
 */
export class EditMode {
  #enabled = signal(false);

  /** @param {AuthSession} session */
  constructor(session) {
    this.canEdit = computed(() => session.isAuthenticated.value);
    this.isOn = computed(() => this.canEdit.value && this.#enabled.value);
  }

  toggle() {
    this.#enabled.value = !this.#enabled.value;
  }

  off() {
    this.#enabled.value = false;
  }
}
