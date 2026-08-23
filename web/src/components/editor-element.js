import { SignalElement } from '@core/elements/signal-element.js';
import { signal } from '@core/foundation/reactive.js';
import { t } from '@core/localization/i18n.js';
import { focusInvalidField } from '@components/inputs/ui-field.js';

import { failureKey } from '../forms.js';

/** @import { FormGroup } from '@core/forms/group.js' */

/**
 * What the five editors on this site do identically: refuse a submit that has an
 * invalid field and put the caret in it, switch the form off while the request is
 * in flight, turn a failure into one sentence, and answer the page with `saved`
 * or `cancelled`.
 *
 * A base class rather than a component: it has no template and no tag, and every
 * editor's markup is its own.
 */
export class EditorElement extends SignalElement {
  busy = signal(false);
  errorKey = signal('');

  get errorMessage() {
    return this.errorKey.value === '' ? '' : t(this.errorKey.value);
  }

  cancel() {
    this.dispatchEvent(new CustomEvent('cancelled'));
  }

  /**
   * The dialect has no statement sequence, so `preventDefault` cannot live in the
   * template beside the call.
   *
   * @param {Event} event
   */
  submit(event) {
    event.preventDefault();
    this.save();
  }

  /** Every editor overrides this; the form's markup is what differs, not the flow. */
  save() {}

  /**
   * @param {FormGroup<any>} form
   * @param {() => Promise<unknown>} write
   */
  commit(form, write) {
    if (!form.markSubmitted()) {
      focusInvalidField(this, form);
      return;
    }

    this.busy.value = true;
    this.errorKey.value = '';
    form.setDisabled(true);

    void write()
      .then((saved) => {
        // The baseline moves to what was just sent, so the form is no longer
        // dirty: a navigation guard asked right after a save must not claim
        // there is unsaved work.
        form.reset(form.values);
        // The record travels with the event: a page that has to navigate to what
        // was just created cannot read the new slug from anywhere else.
        this.dispatchEvent(new CustomEvent('saved', { detail: saved }));
      })
      .catch((cause) => {
        this.errorKey.value = failureKey(cause);
      })
      .finally(() => {
        this.busy.value = false;
        form.setDisabled(false);
      });
  }
}
