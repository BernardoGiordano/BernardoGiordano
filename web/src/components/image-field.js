import { SignalElement } from '@core/elements/signal-element.js';
import { defineComponent } from '@core/elements/component.js';
import { signal } from '@core/foundation/reactive.js';
import { inject } from '@core/foundation/inject.js';
import { t } from '@core/localization/i18n.js';

import { MEDIA } from '../services/media-service.js';
import { attr, failureKey } from '../forms.js';

/**
 * An image, as a form field: what is there now, a button that replaces it, and a
 * button that takes it away.
 *
 * The value is the URL the upload answered with, not the file — the backend
 * re-encodes to WebP at three widths and strips the EXIF, so the only thing worth
 * holding on to is where it put the result.
 *
 * Implements `FormControl` (see `@components/inputs/form-control.js`) rather than
 * being wired by hand, which is what lets `<ui-field>` label it, describe its
 * error and switch it off with every other field in the form.
 */
export class ImageField extends SignalElement {
  static properties = {
    purpose: { type: String },
    previewClass: { type: String, attribute: 'preview-class' },
  };

  /** Recorded on the media row, so uploads can be told apart later. */
  purpose = 'post';

  previewClass = 'size-[72px]';

  url = signal('');
  busy = signal(false);
  errorKey = signal('');

  #disabled = signal(false);
  #invalid = signal(false);
  #describedBy = signal('');
  #labelledBy = signal('');

  /* ── FormControl ────────────────────────────────────────────────────────── */

  get formValue() {
    return this.url.value;
  }

  set formValue(value) {
    this.url.value = typeof value === 'string' ? value : '';
  }

  formEvent = 'image-change';

  focusControl() {
    this.#trigger?.focus();
  }

  /** @param {boolean} state */
  setInvalid(state) {
    this.#invalid.value = state;
  }

  /** @param {string} id */
  setDescribedBy(id) {
    this.#describedBy.value = id;
  }

  /** @param {string} id */
  setLabelledBy(id) {
    this.#labelledBy.value = id;
  }

  /** @param {boolean} state */
  setDisabled(state) {
    this.#disabled.value = state;
  }

  /* ── Template surface ───────────────────────────────────────────────────── */

  get disabled() {
    return this.#disabled.value || this.busy.value;
  }

  get invalidAttr() {
    return this.#invalid.value ? 'true' : 'false';
  }

  get describedByAttr() {
    return attr(this.#describedBy.value);
  }

  get labelledByAttr() {
    return attr(this.#labelledBy.value);
  }

  get buttonLabel() {
    if (this.busy.value) return t('editor.uploading');
    return this.url.value === '' ? t('editor.uploadImage') : t('editor.replaceImage');
  }

  get errorMessage() {
    return this.errorKey.value === '' ? '' : t(this.errorKey.value);
  }

  /* ── Behaviour ──────────────────────────────────────────────────────────── */

  choose() {
    this.#input?.click();
  }

  clear() {
    this.errorKey.value = '';
    this.url.value = '';
    this.#announce();
  }

  /** @param {Event} event */
  pick(event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const file = input.files?.[0];
    // Cleared here rather than after the upload: the same file picked twice in a
    // row fires no `change` event if the input still holds it.
    input.value = '';
    if (file === undefined) return;

    this.busy.value = true;
    this.errorKey.value = '';

    void inject(MEDIA)
      .upload(file, { purpose: this.purpose, filename: file.name })
      .then((media) => {
        this.url.value = media.url;
        this.#announce();
      })
      .catch((cause) => {
        this.errorKey.value = failureKey(cause);
      })
      .finally(() => {
        this.busy.value = false;
      });
  }

  /** `ui-field` listens for this, and it is the only way the form hears an upload. */
  #announce() {
    this.dispatchEvent(new CustomEvent(this.formEvent));
  }

  get #trigger() {
    const button = this.querySelector('button');
    return button instanceof HTMLButtonElement ? button : null;
  }

  get #input() {
    const input = this.querySelector('input[type="file"]');
    return input instanceof HTMLInputElement ? input : null;
  }
}

await defineComponent({ tag: 'image-field', element: ImageField, module: import.meta.url });
