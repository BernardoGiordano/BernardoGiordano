import { SignalElement } from '@core/elements/signal-element.js';
import { defineComponent } from '@core/elements/component.js';
import { signal } from '@core/foundation/reactive.js';
import { schedule } from '@core/foundation/clock.js';
import { t } from '@core/localization/i18n.js';

/**
 * Edit, move, delete: the four controls every editable row on this site has, and
 * the two-step delete they all need.
 *
 * Nothing here is called `remove`: `Element.remove()` is a DOM method, and a
 * component that redefines it hands anything holding the element — the router
 * included — a confirmation step instead of a way to take it out of the page.
 *
 * A confirmation step rather than `window.confirm`, which blocks the page and
 * cannot be styled, and rather than a dialog, which is a lot of machinery for one
 * question about one row. The armed state times out: a row left mid-confirm is a
 * row that will be clicked by accident later.
 */
export class RowTools extends SignalElement {
  static properties = {
    canUp: { type: Boolean, attribute: 'can-up' },
    canDown: { type: Boolean, attribute: 'can-down' },
    canEdit: { type: Boolean, attribute: 'can-edit' },
    canMove: { type: Boolean, attribute: 'can-move' },
    canDelete: { type: Boolean, attribute: 'can-delete' },
    busy: { type: Boolean },
  };

  canUp = false;
  canDown = false;
  canEdit = true;

  /** Off where the order is not a choice: art is sorted by release date. */
  canMove = true;
  canDelete = true;
  busy = false;

  confirming = signal(false);

  /**
   * Cancels the arm timeout, or `undefined` when nothing is armed. Through the
   * library's clock rather than `setTimeout`, because a component that owns its
   * own timer leaves a suite one move — sleep past it — and `assert nothing
   * happened within 5 seconds` is both slow and a weaker claim than the one the
   * test means. A manual clock flushes it instead.
   *
   * @type {(() => void) | undefined}
   */
  #disarm;

  /** When the confirm step became live, so a double-click cannot clear it. */
  #armedAt = 0;

  onDestroy() {
    this.#disarm?.();
  }

  edit() {
    this.#dispatch('edit');
  }

  up() {
    this.#dispatch('move-up');
  }

  down() {
    this.#dispatch('move-down');
  }

  /**
   * First click arms, second deletes — except for the second click of a
   * double-click, which is ignored: the point of the step is that the question
   * gets read, and 300 ms is not long enough to have read it.
   */
  pressDelete() {
    if (!this.confirming.value) {
      this.confirming.value = true;
      this.#armedAt = Date.now();
      this.#disarm?.();
      this.#disarm = schedule(() => {
        this.confirming.value = false;
      }, 5000);
      return;
    }
    if (Date.now() - this.#armedAt < 300) return;
    this.#disarm?.();
    this.confirming.value = false;
    this.#dispatch('remove');
  }

  cancel() {
    this.#disarm?.();
    this.confirming.value = false;
  }

  get confirmLabel() {
    return t('site.confirmDelete');
  }

  /** @param {string} name */
  #dispatch(name) {
    this.dispatchEvent(new CustomEvent(name, { bubbles: false }));
  }
}

await defineComponent({ tag: 'row-tools', element: RowTools, module: import.meta.url });
