import { defineComponent } from '@core/elements/component.js';
import { inject } from '@core/foundation/inject.js';
import { field } from '@core/forms/field.js';
import { group } from '@core/forms/group.js';
import { maxLength, required } from '@core/forms/validators.js';
import { UiField } from '@components/inputs/ui-field.js';

import { EditorElement } from './editor-element.js';
import { CV } from '../services/cv-service.js';

/** @import { CvItem } from '../services/types.js' */

export class CvItemEditor extends EditorElement {
  static properties = {
    record: { attribute: false },
    section: { type: Number },
  };

  /** @type {CvItem | null} */
  record = null;

  /** The section this entry belongs to. Required for both paths: the create
   * endpoint is under the section, and the update answers with it. */
  section = 0;

  /** @type {CvItem | null} */
  #built = null;

  form = buildForm(null);

  /** @param {Map<PropertyKey, unknown>} changed */
  willUpdate(changed) {
    super.willUpdate(changed);
    if (this.record !== this.#built) {
      this.#built = this.record;
      this.form = buildForm(this.record);
    }
  }

  save() {
    const values = this.form.values;
    const patch = {
      title: values.title.trim(),
      subtitle: values.subtitle.trim(),
      detail: values.detail,
      period: values.period.trim(),
    };

    const cv = inject(CV);
    const record = this.record;
    const section = this.section;
    this.commit(this.form, () =>
      record === null ? cv.addItem(section, patch) : cv.saveItem(section, record.id, patch),
    );
  }
}

/** @param {CvItem | null} record */
function buildForm(record) {
  return group({
    title: field(record?.title ?? '', [required(), maxLength(255)]),
    subtitle: field(record?.subtitle ?? '', [maxLength(255)]),
    period: field(record?.period ?? '', [maxLength(64)]),
    detail: field(record?.detail ?? ''),
  });
}

await defineComponent({
  tag: 'cv-item-editor',
  element: CvItemEditor,
  module: import.meta.url,
  uses: [UiField],
});
