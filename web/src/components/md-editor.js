import { SignalElement } from '@core/elements/signal-element.js';
import { defineComponent } from '@core/elements/component.js';
import { peek, signal } from '@core/foundation/reactive.js';
import { inject } from '@core/foundation/inject.js';
import { t } from '@core/localization/i18n.js';

import { MEDIA } from '../services/media-service.js';
import { attr, failureKey } from '../forms.js';
// Side effect, and absent from `uses`: md-body owns its own children, so it is a
// plain custom element rather than a srl component. See its header.
import './md-body.js';

/**
 * Markdown, with a preview of what it will look like and a button that puts an
 * uploaded image into it at the caret.
 *
 * WHY THE TEXTAREA IS NOT A BOUND VALUE
 *
 * `ui-field` writes the field's value back into its control on every change, and
 * assigning `textarea.value` moves the caret to the end — including when the
 * assignment changes nothing, which is every keystroke if it is unconditional.
 * The value is therefore written imperatively and only when it differs, which is
 * also what restores the text after the preview tab has thrown the element away.
 */
export class MdEditor extends SignalElement {
  static properties = {
    rows: { type: Number },
  };

  rows = 18;

  text = signal('');
  previewing = signal(false);
  busy = signal(false);
  errorKey = signal('');

  #disabled = signal(false);
  #invalid = signal(false);
  #describedBy = signal('');
  #labelledBy = signal('');

  /* ── FormControl ────────────────────────────────────────────────────────── */

  get formValue() {
    return this.text.value;
  }

  set formValue(value) {
    const next = typeof value === 'string' ? value : '';
    // `peek`, not `.value`: `ui-field` writes this from inside an effect, and a
    // plain read would subscribe that effect to this signal — every keystroke
    // would then re-run the write-back and clamp the text to what the field held
    // a moment ago. Reading without subscribing is the whole fix.
    if (next === peek(this.text)) return;
    this.text.value = next;
    this.#sync();
  }

  formEvent = 'markdown-change';

  focusControl() {
    this.previewing.value = false;
    queueMicrotask(() => {
      this.#sync();
      this.#area?.focus();
    });
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
    return this.#disabled.value;
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

  get errorMessage() {
    return this.errorKey.value === '' ? '' : t(this.errorKey.value);
  }

  get uploadLabel() {
    return this.busy.value ? t('editor.uploading') : t('editor.insertImage');
  }

  /** @param {boolean} preview */
  tabClasses(preview) {
    return this.previewing.value === preview
      ? 'border-brand text-ink'
      : 'border-transparent text-muted hover:text-ink';
  }

  /* ── Behaviour ──────────────────────────────────────────────────────────── */

  /**
   * `ui-field` binds its control during *its* update, which is before this
   * element has rendered a textarea to write into: opening an editor on an
   * existing post therefore lands the body here and nowhere visible. This is the
   * first moment there is a textarea.
   */
  onMount() {
    this.#sync();
  }

  /** @param {boolean} preview */
  show(preview) {
    this.previewing.value = preview;
    // The textarea the write tab brings back is a new element with an empty
    // value, and nothing restores it on its own: a signal-driven binding update
    // is not a Lit update cycle, so `updated()` is never called for it. The
    // microtask is what lets the branch commit before the value is written.
    if (!preview) queueMicrotask(() => this.#sync());
  }

  /** @param {Event} event */
  type(event) {
    const area = event.target;
    if (!(area instanceof HTMLTextAreaElement)) return;
    this.text.value = area.value;
    this.dispatchEvent(new CustomEvent(this.formEvent));
  }

  chooseImage() {
    this.#input?.click();
  }

  /** @param {Event} event */
  pick(event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const file = input.files?.[0];
    input.value = '';
    if (file === undefined) return;

    this.busy.value = true;
    this.errorKey.value = '';

    void inject(MEDIA)
      .upload(file, { purpose: 'post', filename: file.name })
      .then((media) => {
        this.#insert(`![](${media.url})`);
      })
      .catch((cause) => {
        this.errorKey.value = failureKey(cause);
      })
      .finally(() => {
        this.busy.value = false;
      });
  }

  /**
   * Put `snippet` where the caret is, on its own paragraph, and leave the caret
   * after it.
   *
   * @param {string} snippet
   */
  #insert(snippet) {
    const area = this.#area;
    const current = this.text.value;
    const at = area === null ? current.length : area.selectionStart;
    const before = current.slice(0, at);
    const after = current.slice(at);
    const lead = before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
    const tail = after.startsWith('\n') || after === '' ? '' : '\n\n';
    const block = `${lead}${snippet}${tail}`;

    this.text.value = `${before}${block}${after}`;
    this.#sync();
    this.dispatchEvent(new CustomEvent(this.formEvent));

    if (area === null) return;
    const caret = at + block.length;
    area.focus();
    area.setSelectionRange(caret, caret);
  }

  #sync() {
    const area = this.#area;
    const text = peek(this.text);
    if (area !== null && area.value !== text) area.value = text;
  }

  get #area() {
    const area = this.querySelector('textarea');
    return area instanceof HTMLTextAreaElement ? area : null;
  }

  get #input() {
    const input = this.querySelector('input[type="file"]');
    return input instanceof HTMLInputElement ? input : null;
  }
}

await defineComponent({ tag: 'md-editor', element: MdEditor, module: import.meta.url });
