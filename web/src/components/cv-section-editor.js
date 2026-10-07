import { defineComponent, inject, field, group, maxLength, required } from '@srljs/core';
import { UiField } from '@components/inputs/ui-field.js';

import { EditorElement } from './editor-element.js';
import { CV } from '../services/cv-service.js';

/** @import { CvSection } from '../services/types.js' */

export class CvSectionEditor extends EditorElement {
  static properties = {
    record: { attribute: false },
  };

  /** @type {CvSection | null} */
  record = null;

  /** @type {CvSection | null} */
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
    const patch = { title: values.title.trim(), kind: values.kind.trim() };
    const cv = inject(CV);
    const record = this.record;
    this.commit(this.form, () => (record === null ? cv.addSection(patch) : cv.saveSection(record.id, patch)));
  }
}

/** @param {CvSection | null} record */
function buildForm(record) {
  return group({
    title: field(record?.title ?? '', [required(), maxLength(128)]),
    kind: field(record?.kind ?? '', [maxLength(32)]),
  });
}

await defineComponent({
  tag: 'cv-section-editor',
  element: CvSectionEditor,
  module: import.meta.url,
  uses: [UiField],
});
